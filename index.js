'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseConfig = require('./config');
let config = baseConfig;

const outputDir = path.join(__dirname, 'output');
let root = '';
function batches() {
  const entries = Array.isArray(baseConfig.folders) && baseConfig.folders.length ? baseConfig.folders : [baseConfig.folderPath];
  if (!entries.length) throw Error('At least one folder is required.');
  const result = entries.map(entry => {
    const override = typeof entry === 'string' ? { folderPath: entry } : entry;
    if (!override || typeof override.folderPath !== 'string' || !override.folderPath.trim()) throw Error('Every folder needs folderPath.');
    return { ...baseConfig, ...override, folderPath: path.resolve(override.folderPath) };
  });
  const normRoots = result.map(b => norm(b.folderPath));
  if (new Set(normRoots).size !== normRoots.length) throw Error('Duplicate folder paths in configuration.');
  for (let i = 0; i < normRoots.length; i++) {
    for (let j = i + 1; j < normRoots.length; j++) {
      if (inside(normRoots[i], normRoots[j]) || inside(normRoots[j], normRoots[i])) throw Error('Overlapping folder paths are not supported; use a parent folder with recursive: true instead.');
    }
  }
  return result;
}
function selectBatch(batch) { config = batch; root = batch.folderPath; }
const usage = 'Usage: node index.js scan | preview | rename | undo';
const norm = p => path.resolve(p).toLowerCase();
const relative = p => path.relative(root, p).split(path.sep).join('/');
const writeJSON = (name, value) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2) + '\n');
};
const readJSON = name => JSON.parse(fs.readFileSync(path.join(outputDir, name), 'utf8'));
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function checkRoot() {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw Error('Folder not found: ' + root);
  if (inside(norm(outputDir), norm(root)) || inside(norm(root), norm(outputDir))) {
    throw Error('Target folder cannot be the output directory or inside it.');
  }
}
function scan() {
  checkRoot();
  const result = [];
  const exclusions = new Set((config.extensions || []).map(e => e.toLowerCase().replace(/^([^\.])/, '.$1')));
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (norm(full) === norm(outputDir)) continue;
      if (item.isSymbolicLink()) continue; // Never traverse links outside the root
      if (item.isDirectory()) { if (config.recursive) visit(full); }
      else if (item.isFile()) {
        const ext = path.extname(item.name);
        if (exclusions.size && !exclusions.has(ext.toLowerCase())) continue;
        result.push({ path: full, relativePath: relative(full), name: item.name, extension: ext });
      }
    }
  }
  visit(root);
  result.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
  return result;
}
function safeName(name) {
  if (typeof name !== 'string' || !name.trim() || name !== name.trim()) throw Error('Empty name or leading/trailing whitespace: ' + JSON.stringify(name));
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) throw Error('Invalid Windows filename: ' + name);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw Error('Reserved Windows filename: ' + name);
  if (name.length > 255) throw Error('Filename exceeds 255 UTF-16 code units: ' + name);
  return name;
}
function targetName(proposed, source) {
  safeName(proposed);
  if (config.preserveExtension === false) return proposed;
  const ext = source.extension;
  if (!ext) return proposed;
  const proposedExt = path.extname(proposed);
  if (proposedExt && proposedExt.toLowerCase() === ext.toLowerCase()) return proposed;
  // Reject likely different file extensions; do not silently change file format.
  if (proposedExt && /^[.][a-zA-Z0-9]{1,8}$/.test(proposedExt)) {
    throw Error(`Extension mismatch for ${source.relativePath}: ${proposed} (expected ${ext}). Supply a stem or matching extension.`);
  }
  return proposed + ext;
}
function makePlan(files) {
  const selected = [];
  const mode = config.mode;
  if (mode === 'specific') {
    const used = new Set();
    for (const rule of config.renameMap || []) {
      if (!rule || !rule.newName || !String(rule.newName).trim()) continue;
      if (!!rule.oldName === !!rule.oldPath) throw Error('Each mapping needs exactly one of oldName or oldPath.');
      const matches = files.filter(f => rule.oldPath
        ? f.relativePath.toLowerCase() === String(rule.oldPath).replace(/\\/g, '/').toLowerCase()
        : f.name.toLowerCase() === String(rule.oldName).toLowerCase());
      if (matches.length !== 1) throw Error(`Expected exactly 1 match for ${rule.oldPath || rule.oldName}, found ${matches.length}. Use oldPath to disambiguate.`);
      const f = matches[0];
      if (used.has(norm(f.path))) throw Error('Same source selected twice: ' + f.relativePath);
      used.add(norm(f.path));
      selected.push({ source: f, proposed: rule.newName });
    }
  } else if (mode === 'sequential') {
    if (!Array.isArray(config.newNames) || config.newNames.length !== files.length) {
      throw Error(`Sequential mode needs exactly ${files.length} new names (received ${(config.newNames || []).length}). Review output/inventory.json.`);
    }
    files.forEach((f, i) => selected.push({ source: f, proposed: config.newNames[i] }));
  } else if (mode === 'random') {
    const { prefix = 'FILE_', length = 8 } = config.random || {};
    if (!Number.isInteger(length) || length < 4 || length > 64) throw Error('Random length must be between 4 and 64.');
    files.forEach(f => selected.push({ source: f, proposed: prefix + crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length) }));
  } else if (mode === 'autoNumber') {
    const { prefix = 'Document_', start = 1, padding = 3 } = config.autoNumber || {};
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isInteger(padding) || padding < 1 || padding > 20) throw Error('Invalid numbering settings.');
    files.forEach((f, i) => selected.push({ source: f, proposed: prefix + String(start + i).padStart(padding, '0') }));
  } else throw Error('Unknown mode: ' + mode);

  const operations = selected.map(({ source, proposed }) => {
    const newName = targetName(proposed, source);
    const destination = path.join(path.dirname(source.path), newName);
    return { oldPath: source.path, newPath: destination, oldRelativePath: source.relativePath, newRelativePath: relative(destination) };
  }).filter(op => op.oldPath !== op.newPath);

  const targets = new Set();
  const sources = new Set(operations.map(op => norm(op.oldPath)));
  for (const op of operations) {
    const target = norm(op.newPath);
    if (!inside(norm(root), target) || !path.dirname(op.oldPath).toLowerCase().startsWith(norm(root))) throw Error('Target outside root: ' + op.newPath);
    if (targets.has(target)) throw Error('Duplicate destination: ' + op.newPath);
    targets.add(target);
    // A destination occupied by a file that isn't in the rename plan is forbidden.
    if (fs.existsSync(op.newPath) && !sources.has(target)) throw Error('Destination already exists: ' + op.newPath);
    // On case-insensitive Windows, a differently cased existing name is the same file.
    const neighborNames = fs.readdirSync(path.dirname(op.newPath));
    const neighbor = neighborNames.find(name => name.toLowerCase() === path.basename(op.newPath).toLowerCase());
    if (neighbor && !sources.has(norm(path.join(path.dirname(op.newPath), neighbor)))) {
      throw Error('Destination conflicts with existing file: ' + op.newPath);
    }
  }
  return { version: 2, root, mode, generatedAt: new Date().toISOString(), fileCount: files.length, operations };
}
function discover() {
  const all = [];
  for (const batch of batches()) {
    selectBatch(batch);
    const files = scan();
    all.push({ folderPath: root, files, batch });
  }
  writeJSON('inventory.json', all.map(({ folderPath, files }) => ({
    folderPath, files: files.map(({ relativePath, name, extension }) => ({ relativePath, name, extension }))
  })));
  return all;
}
function preview() {
  const discovered = discover();
  const plans = discovered.map(({ batch, files }) => {
    selectBatch(batch);
    return makePlan(files);
  });
  const plan = {
    version: 2, roots: plans.map(p => p.root), generatedAt: new Date().toISOString(),
    fileCount: plans.reduce((n, p) => n + p.fileCount, 0),
    operations: plans.flatMap(p => p.operations)
  };
  writeJSON('preview.json', plan);
  console.table(plan.operations.map(op => ({ from: op.oldPath, to: op.newPath })));
  console.log(`${plan.operations.length} proposed renames across ${plans.length} folders (${plan.fileCount} eligible files).`);
  return plan;
}
function execute() {
  // Always create a fresh preview, never blindly trust a stale preview.json.
  const plan = preview();
  if (!plan.operations.length) return console.log('Nothing to rename.');
  const historyPath = path.join(outputDir, 'history.json');
  if (fs.existsSync(historyPath)) {
    const prev = readJSON('history.json');
    if (prev.status !== 'undone') throw Error('Previous history has not been undone. Archive/remove output/history.json only after saving it somewhere safe.');
  }
  const run = { ...plan, status: 'in_progress', steps: plan.operations.map(op => ({ ...op, tempPath: null, state: 'original' })) };
  writeJSON('history.json', run);
  try {
    // Stage every file first so swaps and rename cycles cannot overwrite each other.
    for (const step of run.steps) {
      if (!fs.existsSync(step.oldPath) || !fs.statSync(step.oldPath).isFile()) throw Error('Source unavailable: ' + step.oldPath);
      const tmp = path.join(path.dirname(step.oldPath), '.__bulkrename_' + crypto.randomUUID() + '.tmp');
      step.tempPath = tmp;
      writeJSON('history.json', run);
      fs.renameSync(step.oldPath, tmp);
      step.state = 'staged';
      writeJSON('history.json', run);
    }
    for (const step of run.steps) {
      fs.renameSync(step.tempPath, step.newPath);
      step.state = 'renamed';
      writeJSON('history.json', run);
    }
    run.status = 'completed';
    writeJSON('history.json', run);
    console.log(`Successfully renamed ${run.steps.length} files. Undo: node index.js undo`);
  } catch (e) {
    run.status = 'interrupted';
    writeJSON('history.json', run);
    console.error('Rename interrupted. History saved. Do NOT start another rename before reviewing recovery.');
    throw e;
  }
}
function undo() {
  const run = readJSON('history.json');
  if (run.status !== 'completed') throw Error('Only completed runs can be undone automatically. Inspect output/history.json for interrupted runs.');
  const configured = batches().map(b => norm(b.folderPath)).sort();
  const historyRoots = (run.roots || [run.root]).map(norm).sort();
  if (JSON.stringify(configured) !== JSON.stringify(historyRoots)) throw Error('Configured folders differ from the folders in history.');
  // First validate every source and destination; never overwrite user files.
  const occupied = new Set(run.steps.map(s => norm(s.newPath)));
  for (const s of run.steps) {
    if (!fs.existsSync(s.newPath) || !fs.statSync(s.newPath).isFile()) throw Error('Renamed file missing: ' + s.newPath);
    if (fs.readdirSync(path.dirname(s.oldPath)).some(n => n.toLowerCase() === path.basename(s.oldPath).toLowerCase() && !occupied.has(norm(path.join(path.dirname(s.oldPath), n))))) {
      throw Error('Original name now occupied: ' + s.oldPath);
    }
  }
  run.status = 'undo_in_progress';
  writeJSON('history.json', run);
  try {
    for (const s of run.steps) {
      s.undoTemp = path.join(path.dirname(s.newPath), '.__bulkundo_' + crypto.randomUUID() + '.tmp');
      writeJSON('history.json', run);
      fs.renameSync(s.newPath, s.undoTemp);
      s.state = 'undo_staged';
      writeJSON('history.json', run);
    }
    for (const s of run.steps) {
      fs.renameSync(s.undoTemp, s.oldPath);
      s.state = 'undone';
      writeJSON('history.json', run);
    }
    run.status = 'undone';
    writeJSON('history.json', run);
    console.log('Undo complete. Restored ' + run.steps.length + ' filenames.');
  } catch (e) {
    run.status = 'undo_interrupted';
    writeJSON('history.json', run);
    throw e;
  }
}
try {
  switch (process.argv[2]) {
    case 'scan': {
      const results = discover();
      console.table(results.flatMap(({ folderPath, files }) => files.map(f => ({ folder: folderPath, path: f.relativePath, extension: f.extension }))));
      console.log(`Found ${results.reduce((n, r) => n + r.files.length, 0)} files across ${results.length} folders. Saved output/inventory.json`);
      break;
    }
    case 'preview': preview(); break;
    case 'rename': execute(); break;
    case 'undo': undo(); break;
    default: console.log(usage); process.exitCode = 1;
  }
} catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; }
