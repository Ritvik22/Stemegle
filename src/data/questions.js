function question(category, prompt, choices, correctChoice) {
  const answer = choices.indexOf(correctChoice);
  if (answer === -1) throw new Error(`Correct choice missing for: ${prompt}`);
  return { category, q: prompt, choices, answer };
}

export const QUESTION_BANK = [
  // Mathematics (20)
  question('Mathematics', 'What is 12 × 8?', ['84', '96', '108', '112'], '96'),
  question('Mathematics', 'What is the square root of 144?', ['10', '11', '12', '14'], '12'),
  question('Mathematics', 'Solve 3x + 5 = 20.', ['x = 3', 'x = 5', 'x = 7', 'x = 15'], 'x = 5'),
  question('Mathematics', 'What is the sum of the interior angles of a triangle?', ['90°', '180°', '270°', '360°'], '180°'),
  question('Mathematics', 'What is 25% of 80?', ['15', '20', '25', '32'], '20'),
  question('Mathematics', 'What is the next prime number after 29?', ['30', '31', '33', '37'], '31'),
  question('Mathematics', 'What is 2⁵?', ['10', '16', '25', '32'], '32'),
  question('Mathematics', 'What is the slope through (0, 1) and (2, 5)?', ['1', '2', '3', '4'], '2'),
  question('Mathematics', 'What is the area of a circle with radius 3?', ['3π', '6π', '9π', '12π'], '9π'),
  question('Mathematics', 'What is the median of 3, 7, 8, 12, 15?', ['7', '8', '9', '12'], '8'),
  question('Mathematics', 'Which fraction equals 0.75?', ['1/2', '2/3', '3/4', '4/5'], '3/4'),
  question('Mathematics', 'What is the greatest common divisor of 18 and 24?', ['3', '6', '9', '12'], '6'),
  question('Mathematics', 'What is 7! ÷ 6!?', ['1', '6', '7', '42'], '7'),
  question('Mathematics', 'A right triangle has legs 6 and 8. What is its hypotenuse?', ['9', '10', '12', '14'], '10'),
  question('Mathematics', 'What is the sum of the interior angles of a quadrilateral?', ['180°', '270°', '360°', '540°'], '360°'),
  question('Mathematics', 'What is log₁₀(1000)?', ['2', '3', '10', '100'], '3'),
  question('Mathematics', 'What comes next: 2, 6, 18, 54, ...?', ['72', '108', '144', '162'], '162'),
  question('Mathematics', 'What is the probability of heads on one fair coin toss?', ['1/4', '1/3', '1/2', '1'], '1/2'),
  question('Mathematics', 'What is the derivative of x²?', ['x', '2x', 'x³', '2'], '2x'),
  question('Mathematics', 'What is binary 1010 in decimal?', ['8', '10', '12', '14'], '10'),

  // Physics (20)
  question('Physics', 'What is the SI unit of force?', ['Joule', 'Newton', 'Watt', 'Pascal'], 'Newton'),
  question('Physics', 'A bike travels 150 km in 3 hours. What is its average speed?', ['30 km/h', '45 km/h', '50 km/h', '75 km/h'], '50 km/h'),
  question('Physics', 'What is Earth’s gravitational acceleration near the surface?', ['4.9 m/s²', '8.0 m/s²', '9.8 m/s²', '19.6 m/s²'], '9.8 m/s²'),
  question('Physics', 'Which type of energy does a moving object have?', ['Chemical', 'Kinetic', 'Nuclear', 'Thermal'], 'Kinetic'),
  question('Physics', 'What is the SI unit of power?', ['Ampere', 'Joule', 'Volt', 'Watt'], 'Watt'),
  question('Physics', 'What is the SI unit of electric current?', ['Ampere', 'Ohm', 'Tesla', 'Volt'], 'Ampere'),
  question('Physics', 'What is the SI unit of voltage?', ['Ampere', 'Coulomb', 'Ohm', 'Volt'], 'Volt'),
  question('Physics', 'Why can sound not travel through a vacuum?', ['It needs a medium', 'It moves too slowly', 'It has no frequency', 'Gravity blocks it'], 'It needs a medium'),
  question('Physics', 'Where does light travel fastest?', ['Glass', 'Water', 'Air', 'Vacuum'], 'Vacuum'),
  question('Physics', 'Newton’s third law pairs every action with what?', ['A larger force', 'An equal opposite reaction', 'Constant velocity', 'Zero momentum'], 'An equal opposite reaction'),
  question('Physics', 'Density is mass divided by what?', ['Area', 'Force', 'Time', 'Volume'], 'Volume'),
  question('Physics', 'Which is a unit of momentum?', ['kg·m/s', 'kg/m³', 'N/m', 'W/s'], 'kg·m/s'),
  question('Physics', 'What remains the same through components in a series circuit?', ['Current', 'Power', 'Resistance', 'Voltage'], 'Current'),
  question('Physics', 'What remains the same across branches in a parallel circuit?', ['Charge', 'Current', 'Resistance', 'Voltage'], 'Voltage'),
  question('Physics', 'A light ray hits a mirror at 30°. What is its reflection angle?', ['15°', '30°', '60°', '90°'], '30°'),
  question('Physics', 'A 5 Hz wave has a 2 m wavelength. What is its speed?', ['2.5 m/s', '7 m/s', '10 m/s', '25 m/s'], '10 m/s'),
  question('Physics', 'What temperature is absolute zero?', ['0 K', '0 °C', '-100 K', '273 K'], '0 K'),
  question('Physics', 'What is the SI unit of pressure?', ['Joule', 'Newton', 'Pascal', 'Tesla'], 'Pascal'),
  question('Physics', 'What electric charge does an electron carry?', ['Negative', 'Neutral', 'Positive', 'Variable'], 'Negative'),
  question('Physics', 'Near Earth, gravitational potential energy is calculated using which formula?', ['½mv²', 'F/a', 'mgh', 'pV'], 'mgh'),

  // Chemistry (20)
  question('Chemistry', 'What is the chemical formula for water?', ['CO₂', 'H₂O', 'H₂O₂', 'O₂'], 'H₂O'),
  question('Chemistry', 'An element’s atomic number equals its number of what?', ['Electrons and neutrons', 'Neutrons', 'Protons', 'Shells'], 'Protons'),
  question('Chemistry', 'What pH is neutral at room temperature?', ['0', '5', '7', '14'], '7'),
  question('Chemistry', 'What is the formula for table salt?', ['KCl', 'NaCl', 'NaOH', 'HCl'], 'NaCl'),
  question('Chemistry', 'What is the chemical symbol for gold?', ['Ag', 'Au', 'Gd', 'Go'], 'Au'),
  question('Chemistry', 'What is oxygen’s atomic number?', ['6', '7', '8', '16'], '8'),
  question('Chemistry', 'What is the change from liquid to gas called?', ['Condensation', 'Freezing', 'Sublimation', 'Vaporization'], 'Vaporization'),
  question('Chemistry', 'Which bond forms when atoms share electrons?', ['Covalent', 'Hydrogen', 'Ionic', 'Metallic'], 'Covalent'),
  question('Chemistry', 'Vertical columns on the periodic table are called what?', ['Blocks', 'Groups', 'Periods', 'Series'], 'Groups'),
  question('Chemistry', 'What does a catalyst lower?', ['Activation energy', 'Atomic mass', 'Product yield', 'Temperature'], 'Activation energy'),
  question('Chemistry', 'What is the formula for carbon dioxide?', ['CH₄', 'CO', 'CO₂', 'C₂O'], 'CO₂'),
  question('Chemistry', 'Approximately how many particles are in one mole?', ['6.022 × 10²³', '9.81 × 10²', '3.00 × 10⁸', '1.60 × 10⁻¹⁹'], '6.022 × 10²³'),
  question('Chemistry', 'What is the most abundant element in the universe?', ['Carbon', 'Helium', 'Hydrogen', 'Oxygen'], 'Hydrogen'),
  question('Chemistry', 'An acid turns blue litmus paper what color?', ['Black', 'Green', 'Red', 'White'], 'Red'),
  question('Chemistry', 'A basic solution typically has a pH in which range?', ['Below 0', 'Below 7', 'Exactly 7', 'Above 7'], 'Above 7'),
  question('Chemistry', 'What is the chemical symbol for iron?', ['Fe', 'Ir', 'I', 'In'], 'Fe'),
  question('Chemistry', 'Which element is a noble gas?', ['Chlorine', 'Helium', 'Hydrogen', 'Nitrogen'], 'Helium'),
  question('Chemistry', 'Oxidation is the loss of what?', ['Electrons', 'Neutrons', 'Protons', 'Volume'], 'Electrons'),
  question('Chemistry', 'Which element has atomic number 6?', ['Boron', 'Carbon', 'Nitrogen', 'Oxygen'], 'Carbon'),
  question('Chemistry', 'What is the approximate molar mass of water?', ['10 g/mol', '18 g/mol', '24 g/mol', '36 g/mol'], '18 g/mol'),

  // Biology (20)
  question('Biology', 'Which organelle is the powerhouse of the cell?', ['Golgi body', 'Mitochondrion', 'Nucleus', 'Ribosome'], 'Mitochondrion'),
  question('Biology', 'What shape is a DNA molecule?', ['Double helix', 'Flat ring', 'Single sphere', 'Triple chain'], 'Double helix'),
  question('Biology', 'Where does photosynthesis mainly occur in plant cells?', ['Chloroplasts', 'Lysosomes', 'Mitochondria', 'Nuclei'], 'Chloroplasts'),
  question('Biology', 'Which organ pumps blood through the human body?', ['Brain', 'Heart', 'Kidney', 'Lung'], 'Heart'),
  question('Biology', 'What is the largest organ of the human body?', ['Brain', 'Liver', 'Skin', 'Small intestine'], 'Skin'),
  question('Biology', 'What is the basic unit of life?', ['Atom', 'Cell', 'Organ', 'Tissue'], 'Cell'),
  question('Biology', 'How many chromosomes are in a typical human body cell?', ['23', '44', '46', '48'], '46'),
  question('Biology', 'Which blood cells primarily transport oxygen?', ['Platelets', 'Red blood cells', 'Stem cells', 'White blood cells'], 'Red blood cells'),
  question('Biology', 'Which organ produces insulin?', ['Liver', 'Pancreas', 'Stomach', 'Thyroid'], 'Pancreas'),
  question('Biology', 'Which plant structure absorbs most water from soil?', ['Flowers', 'Leaves', 'Roots', 'Stems'], 'Roots'),
  question('Biology', 'Which structure builds proteins in a cell?', ['Cell wall', 'Lysosome', 'Ribosome', 'Vacuole'], 'Ribosome'),
  question('Biology', 'What molecule stores hereditary information?', ['ATP', 'DNA', 'Glucose', 'Water'], 'DNA'),
  question('Biology', 'Which cell division process supports growth and repair?', ['Meiosis', 'Mitosis', 'Osmosis', 'Respiration'], 'Mitosis'),
  question('Biology', 'Which blood type is commonly called the universal red-cell donor?', ['A positive', 'AB positive', 'B negative', 'O negative'], 'O negative'),
  question('Biology', 'Which brain region is especially important for balance?', ['Cerebellum', 'Frontal lobe', 'Hypothalamus', 'Medulla'], 'Cerebellum'),
  question('Biology', 'Which gas do plants take in for photosynthesis?', ['Carbon dioxide', 'Hydrogen', 'Nitrogen', 'Oxygen'], 'Carbon dioxide'),
  question('Biology', 'Which organs filter wastes from the blood?', ['Kidneys', 'Lungs', 'Pancreas', 'Spleen'], 'Kidneys'),
  question('Biology', 'Which organism is a producer in most ecosystems?', ['Fungus', 'Hawk', 'Plant', 'Wolf'], 'Plant'),
  question('Biology', 'What is an enzyme?', ['A biological catalyst', 'A cell membrane', 'A type of sugar', 'Stored genetic code'], 'A biological catalyst'),
  question('Biology', 'What does homeostasis maintain?', ['Constant growth', 'Stable internal conditions', 'Only body temperature', 'Rapid mutation'], 'Stable internal conditions'),

  // Space (20)
  question('Space', 'Which planet is closest to the Sun?', ['Earth', 'Mars', 'Mercury', 'Venus'], 'Mercury'),
  question('Space', 'Which planet is known as the Red Planet?', ['Jupiter', 'Mars', 'Mercury', 'Venus'], 'Mars'),
  question('Space', 'Which is the largest planet in our solar system?', ['Earth', 'Jupiter', 'Neptune', 'Saturn'], 'Jupiter'),
  question('Space', 'What is Earth’s natural satellite?', ['Europa', 'Moon', 'Phobos', 'Titan'], 'Moon'),
  question('Space', 'Which galaxy contains our solar system?', ['Andromeda', 'Milky Way', 'Sombrero', 'Whirlpool'], 'Milky Way'),
  question('Space', 'What star is at the center of our solar system?', ['Polaris', 'Proxima Centauri', 'Sirius', 'The Sun'], 'The Sun'),
  question('Space', 'Which planet has the shortest year?', ['Earth', 'Mars', 'Mercury', 'Venus'], 'Mercury'),
  question('Space', 'Which planet is famous for its prominent rings?', ['Mars', 'Neptune', 'Saturn', 'Venus'], 'Saturn'),
  question('Space', 'What does a light-year measure?', ['Brightness', 'Distance', 'Speed', 'Time'], 'Distance'),
  question('Space', 'Who was the first person to walk on the Moon?', ['Buzz Aldrin', 'John Glenn', 'Neil Armstrong', 'Yuri Gagarin'], 'Neil Armstrong'),
  question('Space', 'How many planets are in our solar system?', ['7', '8', '9', '10'], '8'),
  question('Space', 'Which object is classified as a dwarf planet?', ['Europa', 'Pluto', 'The Moon', 'Venus'], 'Pluto'),
  question('Space', 'Which planet has the hottest average surface temperature?', ['Mars', 'Mercury', 'Saturn', 'Venus'], 'Venus'),
  question('Space', 'What is the main cause of ocean tides on Earth?', ['Earth’s magnetic field', 'Moon’s gravity', 'Solar wind', 'Volcanic activity'], 'Moon’s gravity'),
  question('Space', 'What is a supernova?', ['A forming planet', 'An exploding star', 'A small moon', 'A young galaxy'], 'An exploding star'),
  question('Space', 'What cannot escape from inside a black hole’s event horizon?', ['Dust', 'Gravity', 'Light', 'Time'], 'Light'),
  question('Space', 'Which planet does the International Space Station orbit?', ['Earth', 'Mars', 'Mercury', 'Venus'], 'Earth'),
  question('Space', 'What process powers the Sun?', ['Chemical burning', 'Fission', 'Fusion', 'Radioactive decay'], 'Fusion'),
  question('Space', 'Which is the nearest known star to the Sun?', ['Betelgeuse', 'Polaris', 'Proxima Centauri', 'Sirius'], 'Proxima Centauri'),
  question('Space', 'What is a galaxy?', ['A group of planets only', 'A moon system', 'A vast system of stars, gas, and dust', 'One collapsing star'], 'A vast system of stars, gas, and dust'),

  // Computing & Engineering (20)
  question('Computing', 'What values can one binary bit represent?', ['0 or 1', '0 through 9', 'A through Z', 'Any two-digit number'], '0 or 1'),
  question('Computing', 'What does CPU stand for?', ['Central Processing Unit', 'Computer Power Utility', 'Core Program User', 'Central Peripheral Unit'], 'Central Processing Unit'),
  question('Computing', 'What is HTML mainly used to define?', ['Database queries', 'Page structure', 'Server cooling', 'Visual styling only'], 'Page structure'),
  question('Computing', 'What is CSS mainly used for?', ['Compiling programs', 'Encrypting files', 'Styling web pages', 'Storing records'], 'Styling web pages'),
  question('Computing', 'What is an algorithm?', ['A hardware chip', 'A step-by-step procedure', 'A type of monitor', 'An internet cable'], 'A step-by-step procedure'),
  question('Computing', 'What does a loop do in a program?', ['Deletes code', 'Repeats instructions', 'Shuts down hardware', 'Stores one character'], 'Repeats instructions'),
  question('Computing', 'Which values belong to the Boolean data type?', ['0 through 255', 'Letters only', 'True and false', 'Whole numbers'], 'True and false'),
  question('Computing', 'What kind of memory is RAM?', ['Long-term optical storage', 'Permanent firmware only', 'Volatile working memory', 'Write-once memory'], 'Volatile working memory'),
  question('Computing', 'Which protocol is central to loading websites?', ['FTP', 'HTTP', 'SMTP', 'USB'], 'HTTP'),
  question('Computing', 'What is Git primarily used for?', ['Image editing', 'Version control', 'Video streaming', 'Wireless networking'], 'Version control'),
  question('Engineering', 'What does a sensor do?', ['Generates only heat', 'Measures a physical condition', 'Stores fuel', 'Strengthens metal'], 'Measures a physical condition'),
  question('Engineering', 'Which simple machine is a rigid bar that pivots on a fulcrum?', ['Lever', 'Pulley', 'Screw', 'Wedge'], 'Lever'),
  question('Engineering', 'Two directly meshed gears rotate in which relative directions?', ['The same direction', 'Opposite directions', 'Random directions', 'Neither rotates'], 'Opposite directions'),
  question('Engineering', 'Which shape is commonly used to make trusses rigid?', ['Circle', 'Hexagon', 'Square', 'Triangle'], 'Triangle'),
  question('Engineering', 'What energy conversion occurs in an electric motor?', ['Electrical to mechanical', 'Heat to nuclear', 'Mechanical to chemical', 'Sound to electrical only'], 'Electrical to mechanical'),
  question('Engineering', 'A typical 3D printer builds objects using which process?', ['Additive manufacturing', 'Casting only', 'Chemical etching', 'Subtractive milling'], 'Additive manufacturing'),
  question('Computing', 'When does an AND logic gate output true?', ['Both inputs are true', 'Either input is true', 'Neither input matters', 'Only one input is true'], 'Both inputs are true'),
  question('Computing', 'What is a software bug?', ['A design color', 'A program error', 'A security update', 'A user account'], 'A program error'),
  question('Computing', 'What is a database designed to store?', ['Only images', 'Organized data', 'Processor instructions only', 'Temporary pixels'], 'Organized data'),
  question('Computing', 'What does encryption do to readable data?', ['Compresses it only', 'Converts it into coded form', 'Deletes it permanently', 'Prints it'], 'Converts it into coded form'),
];

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function getQuestionsForMatch(matchId, count = 5) {
  const random = createRandom(hashSeed(matchId));
  const categories = shuffled([...new Set(QUESTION_BANK.map((item) => item.category))], random);
  const selected = [];

  for (const category of categories) {
    const categoryQuestions = QUESTION_BANK.filter((item) => item.category === category);
    selected.push(shuffled(categoryQuestions, random)[0]);
    if (selected.length === count) break;
  }

  return selected;
}
