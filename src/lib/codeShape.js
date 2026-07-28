export const MAX_CODE_SHAPE_LINES = 80;

export function isCodeShape(value) {
  return Array.isArray(value)
    && value.length <= MAX_CODE_SHAPE_LINES
    && value.every((line) => line !== null
      && typeof line === 'object'
      && !Array.isArray(line)
      && Object.keys(line).every((key) => ['indent', 'width'].includes(key))
      && Number.isInteger(line.indent) && line.indent >= 0 && line.indent <= 6
      && Number.isInteger(line.width) && line.width >= 0 && line.width <= 12);
}

export function codeShapeFromSource(source) {
  return String(source || '')
    .split('\n')
    .slice(0, MAX_CODE_SHAPE_LINES)
    .map((line) => {
      const leadingWhitespace = line.match(/^[\t ]*/)?.[0] || '';
      const indentationWidth = [...leadingWhitespace].reduce(
        (total, character) => total + (character === '\t' ? 2 : 1),
        0,
      );
      const contentLength = line.trim().length;
      return {
        indent: Math.min(6, Math.floor(indentationWidth / 2)),
        width: contentLength ? Math.min(12, Math.max(2, Math.ceil(contentLength / 5))) : 0,
      };
    });
}
