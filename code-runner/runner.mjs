import { createServer } from 'node:http';
import { chown, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = 96 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMPILE_TIMEOUT_MS = 6000;
const RUN_TIMEOUT_MS = 2200;
const MAX_CASES = 12;
const MAX_CONCURRENT_JOBS = 2;
const SANDBOX_COMMAND = process.env.CODEGLE_SANDBOX_COMMAND || '';
const SANDBOX_UID = Number(process.env.CODEGLE_SANDBOX_UID || 65534);
const SANDBOX_GID = Number(process.env.CODEGLE_SANDBOX_GID || 65534);
let activeJobs = 0;

const LANGUAGE_CONFIG = {
  python: { filename: 'main.py', run: ['python3', '-I', 'main.py'] },
  javascript: { filename: 'main.js', run: ['node', '--disable-proto=throw', 'main.js'] },
  cpp: { filename: 'main.cpp', compile: ['g++', '-std=c++17', '-O2', '-pipe', 'main.cpp', '-o', 'main'], run: ['./main'] },
  java: { filename: 'Main.java', compile: ['javac', '-encoding', 'UTF-8', 'Main.java'], run: ['java', '-Xms16m', '-Xmx96m', '-XX:ActiveProcessorCount=1', '-cp', '.', 'Main'] },
};

function normalizedOutput(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trimEnd();
}

function execute(command, args, { cwd, input = '', timeoutMs }) {
  return new Promise((resolve) => {
    const wrappedCommand = SANDBOX_COMMAND || command;
    const wrappedArgs = SANDBOX_COMMAND ? [command, ...args] : args;
    const child = spawn(wrappedCommand, wrappedArgs, {
      cwd,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: cwd, LANG: 'C.UTF-8' },
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let tooLarge = false;
    const stop = () => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const collect = (target) => (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) { tooLarge = true; stop(); return; }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: '', stderr: error.message, timedOut, tooLarge });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code: Number(code ?? -1),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        tooLarge,
      });
    });
    child.stdin.end(input);
  });
}

async function judge({ language, source, cases }) {
  const config = LANGUAGE_CONFIG[language];
  if (!config || typeof source !== 'string' || Buffer.byteLength(source) > MAX_SOURCE_BYTES
    || !Array.isArray(cases) || cases.length < 1 || cases.length > MAX_CASES) {
    return { status: 'invalid', message: 'Invalid submission.' };
  }
  const directory = await mkdtemp(join(tmpdir(), 'codegle-'));
  try {
    await writeFile(join(directory, config.filename), source, { mode: 0o600 });
    if (SANDBOX_COMMAND) {
      await chown(directory, SANDBOX_UID, SANDBOX_GID);
      await chown(join(directory, config.filename), SANDBOX_UID, SANDBOX_GID);
    }
    if (config.compile) {
      const [command, ...args] = config.compile;
      const compiled = await execute(command, args, { cwd: directory, timeoutMs: COMPILE_TIMEOUT_MS });
      if (compiled.timedOut) return { status: 'compile_error', message: 'Compilation timed out.' };
      if (compiled.tooLarge) return { status: 'compile_error', message: 'Compiler output was too large.' };
      if (compiled.code !== 0) return { status: 'compile_error', message: normalizedOutput(compiled.stderr).slice(0, 4000) || 'Compilation failed.' };
    }
    for (const [index, testCase] of cases.entries()) {
      if (!testCase || typeof testCase.input !== 'string' || typeof testCase.expected !== 'string') {
        return { status: 'invalid', message: 'Invalid test case.' };
      }
      const [command, ...args] = config.run;
      const result = await execute(command, args, { cwd: directory, input: testCase.input, timeoutMs: RUN_TIMEOUT_MS });
      if (result.timedOut) return { status: 'timeout', caseIndex: index, message: 'Time limit exceeded.' };
      if (result.tooLarge) return { status: 'runtime_error', caseIndex: index, message: 'Program output was too large.' };
      if (result.code !== 0) return { status: 'runtime_error', caseIndex: index, message: normalizedOutput(result.stderr).slice(0, 4000) || 'Program exited with an error.' };
      if (normalizedOutput(result.stdout) !== normalizedOutput(testCase.expected)) {
        return { status: 'wrong_answer', caseIndex: index, message: `Wrong answer on hidden test ${index + 1}.` };
      }
    }
    return { status: 'accepted', message: `Passed ${cases.length} tests.` };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  if (request.method !== 'POST' || request.url !== '/run') {
    response.writeHead(404).end();
    return;
  }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '1' });
    response.end('{"status":"busy","message":"Compiler is busy. Try again in a moment."}');
    return;
  }
  activeJobs += 1;
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        response.writeHead(413, { 'content-type': 'application/json' });
        response.end('{"status":"invalid","message":"Submission is too large."}');
        return;
      }
      chunks.push(chunk);
    }
    const result = await judge(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end('{"status":"invalid","message":"Could not read submission."}');
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
  }
});

server.requestTimeout = 15_000;
server.listen(PORT, '0.0.0.0');

process.on('SIGTERM', () => server.close(() => process.exit(0)));
