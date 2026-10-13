const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const project = __dirname;
const configPath = path.join(project, 'config.js');
const original = fs.readFileSync(configPath, 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-rename-test-'));
const put = (name) => { const p=path.join(root, name); fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p,name); };
function run(config, action, shouldSucceed=true) {
  fs.writeFileSync(configPath, 'module.exports = ' + JSON.stringify({folderPath:root,recursive:true, preserveExtension:true,extensions:[], ...config}, null, 2));
  const result = cp.spawnSync(process.execPath, ['index.js',action], {cwd:project, encoding:'utf8'});
  assert.equal(result.status === 0, shouldSucceed, result.stdout + '\n' + result.stderr);
  return result;
}
const output = path.join(project, 'output');
try {
  fs.rmSync(output, {recursive:true, force:true});
  put('A/a.jpg'); put('B/b.pdf'); put('C/c.xlsx');
  let cfg = {mode:'sequential', newNames:['One','Two','Three']};
  run(cfg,'scan'); run(cfg,'preview');
  assert.equal(fs.existsSync(path.join(root,'A/a.jpg')),true);
  run(cfg,'rename');
  assert.ok(fs.existsSync(path.join(root,'A/One.jpg')));
  assert.ok(fs.existsSync(path.join(root,'B/Two.pdf')));
  assert.ok(fs.existsSync(path.join(root,'C/Three.xlsx')));
  run(cfg,'undo');
  assert.ok(fs.existsSync(path.join(root,'A/a.jpg')));
  fs.rmSync(output, {recursive:true,force:true});
  cfg = { mode:'specific', renameMap:[{oldPath:'A/a.jpg',newName:'Z.jpg'},{oldName:'b.pdf',newName:'Final.pdf'}]};
  run(cfg,'rename');
  assert.ok(fs.existsSync(path.join(root,'A/Z.jpg')));
  assert.ok(fs.existsSync(path.join(root,'B/Final.pdf')));
  run(cfg,'undo');
  fs.rmSync(output, {recursive:true,force:true});
  cfg = {mode:'autoNumber', autoNumber:{prefix:'D_',start:1,padding:2}};
  run(cfg,'rename'); run(cfg,'undo');
  fs.rmSync(output, {recursive:true,force:true});
  cfg = {mode:'random', random:{prefix:'R_', length:8}};
  run(cfg,'rename'); run(cfg,'undo');
  fs.rmSync(output, {recursive:true,force:true});
  run({mode:'sequential',newNames:['OnlyOne']},'preview',false);
  put('B/a.jpg');
  run({mode:'specific',renameMap:[{oldName:'a.jpg',newName:'new.jpg'}]},'preview',false);
  console.log('PASS: scan, preview, all 4 rename modes, undo, missing names, ambiguous names');
} finally {
  fs.writeFileSync(configPath, original);
  fs.rmSync(root, {recursive:true,force:true});
  fs.rmSync(output, {recursive:true,force:true});
}
