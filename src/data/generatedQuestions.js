function question(category, prompt, choices, correctChoice) {
  const answer = choices.indexOf(correctChoice);
  if (answer === -1) throw new Error(`Correct choice missing for: ${prompt}`);
  return { category, q: prompt, choices, answer };
}

function makeChoices(correct, distractors) {
  const values = [correct, ...distractors]
    .map((value) => String(value))
    .filter((value, index, list) => list.indexOf(value) === index);

  let next = Number(correct);
  while (values.length < 4 && Number.isFinite(next)) {
    next += values.length + 1;
    if (!values.includes(String(next))) values.push(String(next));
  }
  const genericDistractors = ['None of these', 'Cannot be determined', 'All of these', 'More information needed'];
  for (const distractor of genericDistractors) {
    if (values.length >= 4) break;
    if (!values.includes(distractor)) values.push(distractor);
  }

  return values.slice(0, 4);
}

function rotateChoices(choices, seed) {
  const shift = seed % choices.length;
  return [...choices.slice(shift), ...choices.slice(0, shift)];
}

function numericQuestion(category, prompt, correct, distractors, seed) {
  const correctChoice = String(correct);
  return question(category, prompt, rotateChoices(makeChoices(correctChoice, distractors), seed), correctChoice);
}

function wordQuestion(category, prompt, correct, distractors, seed) {
  const correctChoice = String(correct);
  const choices = rotateChoices(makeChoices(correctChoice, distractors), seed);
  return question(category, prompt, choices, correctChoice);
}

function uniquePush(bank, seen, item) {
  if (seen.has(item.q)) throw new Error(`Duplicate generated prompt: ${item.q}`);
  seen.add(item.q);
  bank.push(item);
}

function buildMathQuestions(bank, seen) {
  let index = 1;
  for (let a = 6; a <= 45 && index <= 800; a += 1) {
    for (let b = 3; b <= 22 && index <= 800; b += 1) {
      const type = index % 8;
      let item;
      if (type === 0) {
        item = numericQuestion('Mathematics', `Practice ${index}: What is ${a} + ${b}?`, a + b, [a + b - 2, a + b + 3, a + b + 6], index);
      } else if (type === 1) {
        item = numericQuestion('Mathematics', `Practice ${index}: What is ${a} × ${b}?`, a * b, [a * b - b, a * b + a, a * b + b], index);
      } else if (type === 2) {
        item = numericQuestion('Mathematics', `Practice ${index}: Solve x + ${b} = ${a + b}.`, a, [a - 2, a + 2, a + b], index);
      } else if (type === 3) {
        item = numericQuestion('Mathematics', `Practice ${index}: What is ${a * 2}% of ${b * 10}?`, (a * 2 * b * 10) / 100, [(a * b) / 10, a + b, a * b], index);
      } else if (type === 4) {
        item = numericQuestion('Mathematics', `Practice ${index}: A rectangle is ${a} by ${b}. What is its area?`, a * b, [a + b, 2 * (a + b), a * b + a], index);
      } else if (type === 5) {
        item = numericQuestion('Mathematics', `Practice ${index}: A rectangle is ${a} by ${b}. What is its perimeter?`, 2 * (a + b), [a + b, a * b, 2 * a + b], index);
      } else if (type === 6) {
        item = numericQuestion('Mathematics', `Practice ${index}: What is ${a * b} ÷ ${b}?`, a, [b, a + b, Math.max(1, a - 1)], index);
      } else {
        item = numericQuestion('Mathematics', `Practice ${index}: What is ${a} squared?`, a * a, [a * 2, a * a - a, a * a + a], index);
      }
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildPhysicsQuestions(bank, seen) {
  const units = [
    ['force', 'Newton', ['Joule', 'Watt', 'Pascal']],
    ['energy', 'Joule', ['Newton', 'Volt', 'Ampere']],
    ['power', 'Watt', ['Ohm', 'Joule', 'Tesla']],
    ['frequency', 'Hertz', ['Meter', 'Newton', 'Coulomb']],
    ['electric current', 'Ampere', ['Volt', 'Ohm', 'Watt']],
    ['voltage', 'Volt', ['Ampere', 'Ohm', 'Joule']],
    ['resistance', 'Ohm', ['Volt', 'Watt', 'Farad']],
  ];
  const facts = [
    ['What type of energy does a moving object have?', 'Kinetic energy', ['Chemical energy', 'Sound energy', 'Nuclear energy']],
    ['What simple machine uses a wheel and rope?', 'Pulley', ['Wedge', 'Screw', 'Inclined plane']],
    ['What happens to speed when distance increases but time stays the same?', 'Speed increases', ['Speed decreases', 'Speed becomes zero', 'Speed is unchanged']],
    ['Which material is usually a good electrical conductor?', 'Copper', ['Rubber', 'Plastic', 'Glass']],
    ['What force pulls objects toward Earth?', 'Gravity', ['Friction', 'Magnetism', 'Tension']],
    ['What kind of wave is light?', 'Electromagnetic wave', ['Sound wave', 'Water wave', 'Seismic P wave']],
  ];
  let index = 1;
  for (let speed = 2; speed <= 36 && index <= 700; speed += 1) {
    for (let time = 2; time <= 21 && index <= 700; time += 1) {
      const type = index % 7;
      let item;
      if (type === 0) {
        const [quantity, correct, distractors] = units[index % units.length];
        item = wordQuestion('Physics', `Practice ${index}: What is the SI unit of ${quantity}?`, correct, distractors, index);
      } else if (type === 1) {
        item = numericQuestion('Physics', `Practice ${index}: An object moves ${speed * time} meters in ${time} seconds. What is its speed?`, `${speed} m/s`, [`${speed + 1} m/s`, `${Math.max(1, speed - 1)} m/s`, `${speed * time} m/s`], index);
      } else if (type === 2) {
        item = numericQuestion('Physics', `Practice ${index}: A ${time} kg object accelerates at ${speed} m/s². What force acts on it?`, `${speed * time} N`, [`${speed + time} N`, `${speed * 2} N`, `${time * 2} N`], index);
      } else if (type === 3) {
        item = numericQuestion('Physics', `Practice ${index}: A wave has frequency ${speed} Hz and wavelength ${time} m. What is its speed?`, `${speed * time} m/s`, [`${speed + time} m/s`, `${Math.max(1, speed - time)} m/s`, `${speed} m/s`], index);
      } else if (type === 4) {
        item = numericQuestion('Physics', `Practice ${index}: A ${speed} ohm resistor has ${speed * time} volts across it. What is the current?`, `${time} A`, [`${speed} A`, `${speed + time} A`, `${Math.max(1, time - 1)} A`], index);
      } else if (type === 5) {
        const [prompt, correct, distractors] = facts[index % facts.length];
        item = wordQuestion('Physics', `Practice ${index}: ${prompt}`, correct, distractors, index);
      } else {
        item = numericQuestion('Physics', `Practice ${index}: A force of ${speed} N moves an object ${time} m. How much work is done?`, `${speed * time} J`, [`${speed + time} J`, `${speed} J`, `${time} J`], index);
      }
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildChemistryQuestions(bank, seen) {
  const elements = [
    ['hydrogen', 'H', ['He', 'O', 'N']],
    ['oxygen', 'O', ['Au', 'Ag', 'Os']],
    ['carbon', 'C', ['Ca', 'Co', 'Cl']],
    ['nitrogen', 'N', ['Na', 'Ni', 'Ne']],
    ['sodium', 'Na', ['S', 'N', 'Sn']],
    ['chlorine', 'Cl', ['C', 'Ca', 'Cr']],
    ['iron', 'Fe', ['Ir', 'I', 'In']],
    ['gold', 'Au', ['Ag', 'Gd', 'Go']],
    ['silver', 'Ag', ['Au', 'Si', 'S']],
    ['helium', 'He', ['H', 'Hg', 'Ho']],
  ];
  const compounds = [
    ['water', 'H₂O', ['CO₂', 'O₂', 'NaCl']],
    ['carbon dioxide', 'CO₂', ['CO', 'H₂O', 'O₂']],
    ['table salt', 'NaCl', ['HCl', 'NaOH', 'KCl']],
    ['oxygen gas', 'O₂', ['O₃', 'CO₂', 'H₂']],
    ['hydrogen gas', 'H₂', ['He', 'H₂O', 'N₂']],
  ];
  const concepts = [
    ['What pH is neutral?', '7', ['0', '3', '14']],
    ['What particle has a positive charge?', 'Proton', ['Neutron', 'Electron', 'Molecule']],
    ['What particle has a negative charge?', 'Electron', ['Proton', 'Neutron', 'Nucleus']],
    ['What is a substance with only one kind of atom called?', 'Element', ['Mixture', 'Solution', 'Compound']],
    ['What bond forms when atoms share electrons?', 'Covalent bond', ['Ionic bond', 'Metallic bond', 'Hydrogen bond']],
    ['What state of matter has a fixed shape and volume?', 'Solid', ['Liquid', 'Gas', 'Plasma']],
  ];
  let index = 1;
  for (let outer = 0; outer < 100 && index <= 700; outer += 1) {
    for (let inner = 0; inner < 10 && index <= 700; inner += 1) {
      const type = index % 5;
      let item;
      if (type === 0) {
        const [name, correct, distractors] = elements[(outer + inner) % elements.length];
        item = wordQuestion('Chemistry', `Practice ${index}: What is the chemical symbol for ${name}?`, correct, distractors, index);
      } else if (type === 1) {
        const [name, correct, distractors] = compounds[(outer + inner) % compounds.length];
        item = wordQuestion('Chemistry', `Practice ${index}: What is the formula for ${name}?`, correct, distractors, index);
      } else if (type === 2) {
        const [prompt, correct, distractors] = concepts[(outer + inner) % concepts.length];
        item = wordQuestion('Chemistry', `Practice ${index}: ${prompt}`, correct, distractors, index);
      } else if (type === 3) {
        const protons = 2 + ((outer + inner) % 18);
        item = numericQuestion('Chemistry', `Practice ${index}: An atom has ${protons} protons. What is its atomic number?`, protons, [protons + 1, Math.max(1, protons - 1), protons * 2], index);
      } else {
        const ph = 8 + ((outer + inner) % 6);
        item = wordQuestion('Chemistry', `Practice ${index}: A solution with pH ${ph} is usually what?`, 'Basic', ['Acidic', 'Neutral', 'A pure element'], index);
      }
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildBiologyQuestions(bank, seen) {
  const facts = [
    ['Which organelle is known as the powerhouse of the cell?', 'Mitochondrion', ['Nucleus', 'Ribosome', 'Cell wall']],
    ['What molecule stores genetic information?', 'DNA', ['ATP', 'Glucose', 'Water']],
    ['Which organ pumps blood?', 'Heart', ['Liver', 'Kidney', 'Lung']],
    ['Which cells carry oxygen in blood?', 'Red blood cells', ['White blood cells', 'Platelets', 'Nerve cells']],
    ['Which plant part absorbs most water?', 'Roots', ['Flowers', 'Leaves', 'Fruit']],
    ['Which gas do plants take in for photosynthesis?', 'Carbon dioxide', ['Oxygen', 'Nitrogen', 'Hydrogen']],
    ['What is the basic unit of life?', 'Cell', ['Atom', 'Organ', 'Tissue']],
    ['Which process makes food in plants?', 'Photosynthesis', ['Digestion', 'Respiration', 'Fermentation']],
    ['What system includes the brain and nerves?', 'Nervous system', ['Digestive system', 'Skeletal system', 'Respiratory system']],
    ['What do enzymes do?', 'Speed up reactions', ['Store memories', 'Carry oxygen', 'Make bones hard']],
  ];
  let index = 1;
  for (let outer = 0; outer < 70 && index <= 700; outer += 1) {
    for (let inner = 0; inner < facts.length && index <= 700; inner += 1) {
      const [prompt, correct, distractors] = facts[(outer + inner) % facts.length];
      const item = wordQuestion('Biology', `Practice ${index}: ${prompt}`, correct, distractors, index);
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildSpaceQuestions(bank, seen) {
  const facts = [
    ['Which planet is closest to the Sun?', 'Mercury', ['Venus', 'Earth', 'Mars']],
    ['Which planet is called the Red Planet?', 'Mars', ['Venus', 'Jupiter', 'Mercury']],
    ['Which planet is largest in our solar system?', 'Jupiter', ['Earth', 'Saturn', 'Neptune']],
    ['What is Earth’s natural satellite?', 'The Moon', ['Mars', 'Europa', 'Titan']],
    ['What star is at the center of our solar system?', 'The Sun', ['Polaris', 'Sirius', 'Vega']],
    ['What does a light-year measure?', 'Distance', ['Time', 'Brightness', 'Mass']],
    ['Which planet is famous for rings?', 'Saturn', ['Mars', 'Venus', 'Mercury']],
    ['What galaxy are we in?', 'Milky Way', ['Andromeda', 'Whirlpool', 'Sombrero']],
    ['What object can have a tail when near the Sun?', 'Comet', ['Moon', 'Planet', 'Galaxy']],
    ['What force keeps planets in orbit around the Sun?', 'Gravity', ['Friction', 'Magnetism', 'Sound']],
  ];
  let index = 1;
  for (let outer = 0; outer < 70 && index <= 700; outer += 1) {
    for (let inner = 0; inner < facts.length && index <= 700; inner += 1) {
      const [prompt, correct, distractors] = facts[(outer + inner) % facts.length];
      const item = wordQuestion('Space', `Practice ${index}: ${prompt}`, correct, distractors, index);
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildComputingQuestions(bank, seen) {
  const facts = [
    ['What values can one binary bit represent?', '0 or 1', ['0 through 9', 'A through Z', 'Any color']],
    ['What does CPU stand for?', 'Central Processing Unit', ['Computer Power Unit', 'Central Program Utility', 'Core Pixel Unit']],
    ['What is an algorithm?', 'A step-by-step procedure', ['A computer screen', 'A power cable', 'A color palette']],
    ['What does a loop do?', 'Repeats instructions', ['Deletes a file', 'Turns off Wi-Fi', 'Changes hardware']],
    ['What is a software bug?', 'A program error', ['A type of monitor', 'A keyboard shortcut', 'A screen color']],
    ['What is HTML mainly used for?', 'Page structure', ['Battery power', 'Image compression', 'Sound recording']],
    ['What is CSS mainly used for?', 'Styling web pages', ['Storing passwords', 'Running motors', 'Cooling computers']],
    ['What type has true or false values?', 'Boolean', ['String', 'Image', 'Folder']],
    ['What is RAM used for?', 'Temporary working memory', ['Permanent paper storage', 'Internet speed only', 'Printer ink']],
    ['What is a database used to store?', 'Organized data', ['Only sound', 'Only electricity', 'Only cables']],
  ];
  let index = 1;
  for (let outer = 0; outer < 70 && index <= 700; outer += 1) {
    for (let inner = 0; inner < facts.length && index <= 700; inner += 1) {
      const [prompt, correct, distractors] = facts[(outer + inner) % facts.length];
      const item = wordQuestion('Computing', `Practice ${index}: ${prompt}`, correct, distractors, index);
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildEngineeringQuestions(bank, seen) {
  const facts = [
    ['Which simple machine is a rigid bar that pivots?', 'Lever', ['Pulley', 'Screw', 'Wedge']],
    ['Which shape makes trusses strong?', 'Triangle', ['Circle', 'Oval', 'Pentagon']],
    ['What does a sensor do?', 'Measures a condition', ['Stores fuel', 'Paints metal', 'Makes noise only']],
    ['What does an electric motor convert electricity into?', 'Motion', ['Food', 'Water', 'Light only']],
    ['What protects steel from rust using zinc?', 'Galvanizing', ['Freezing', 'Melting', 'Sanding']],
    ['What tool measures temperature?', 'Thermometer', ['Ruler', 'Scale', 'Compass']],
    ['What is a prototype?', 'An early test model', ['A finished law', 'A type of battery', 'A natural rock']],
    ['What does a gear usually transfer?', 'Rotating motion', ['Smell', 'Color', 'Heat only']],
    ['What does insulation reduce?', 'Heat or electrical transfer', ['Mass', 'Length', 'Time']],
    ['What does a pump move?', 'Fluid', ['Computer code', 'Sunlight', 'Sound waves only']],
  ];
  let index = 1;
  for (let outer = 0; outer < 70 && index <= 700; outer += 1) {
    for (let inner = 0; inner < facts.length && index <= 700; inner += 1) {
      const [prompt, correct, distractors] = facts[(outer + inner) % facts.length];
      const item = wordQuestion('Engineering', `Practice ${index}: ${prompt}`, correct, distractors, index);
      uniquePush(bank, seen, item);
      index += 1;
    }
  }
}

function buildGeneratedQuestions() {
  const bank = [];
  const seen = new Set();
  buildMathQuestions(bank, seen);
  buildPhysicsQuestions(bank, seen);
  buildChemistryQuestions(bank, seen);
  buildBiologyQuestions(bank, seen);
  buildSpaceQuestions(bank, seen);
  buildComputingQuestions(bank, seen);
  buildEngineeringQuestions(bank, seen);
  return bank;
}

export const GENERATED_QUESTION_BANK = buildGeneratedQuestions();
