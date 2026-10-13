# Universal Windows Bulk File Renamer

Requires **Node.js 18+**. No dependencies, Playwright, or npm install necessary.

## Setup

1. Install Node.js from https://nodejs.org/ and check `node --version`.
2. Unzip this project to a location **outside** the folder whose files you intend to rename.
3. Edit `config.js`: set `folderPath`, `mode`, and that mode's input options.
4. From Windows PowerShell or Command Prompt in the project directory:

```powershell
node index.js scan
node index.js preview
node index.js rename
node index.js undo
```

Use `scan` to export **every eligible original name and extension** to `output/inventory.json`. It also shows relative paths, which disambiguate identical filenames in different subfolders. `preview` produces `output/preview.json` without modifying files. `rename` regenerates the plan, then applies it. `undo` reverses the last **completed** run, if files and original names are available.

## Modes

**specific**: Rename only chosen files. Use `oldPath` relative to `folderPath` (recommended), or `oldName` only when unique across all scanned folders. Leave `newName` empty to skip a rule.

```js
mode: 'specific',
renameMap: [
  { oldPath: 'Folder_A\\ABC.jpg', newName: 'XYZ.jpg' },
  { oldName: 'Invoice.pdf', newName: 'Final_Invoice.pdf' }
],
```

**sequential**: Scan and sort files by **relative path** (case-sensitive character order), then assign names in order from `newNames`. Exactly one new name is required per eligible file. You don't specify original names.

```js
mode: 'sequential',
newNames: ['First', 'Second', 'Third'],
```

**random**: Randomly generate names. `random: { prefix: 'FILE_', length: 8 }`.

**autoNumber**: Name files `Document_001`, `Document_002`, etc. `autoNumber: { prefix: 'Document_', start: 1, padding: 3 }`.

All modes preserve original extensions by default. The code does not convert file formats. Set `extensions: ['.jpg','.png']` to limit eligibility, or `[]` for all file types. Set `recursive: false` to process only the root directory.

## Safety

- Copy or back up critical data before renaming. Use `preview` and inspect the entire mapping first.
- Files remain in their original folders. Symlinked directories/files are ignored.
- The tool rejects ambiguous matching, invalid Windows filenames, naming collisions, existing targets, and sequential array length mismatches.
- Existing completed undo history is protected: rename refuses to replace it until it has been undone or manually archived. Archive the file somewhere safe if you're starting a new batch without undoing the last one.
- The `output` folder is excluded from scanning. Keep the project itself outside the target folder for best results.
- `history.json` is an operation journal; a crash or permission error can leave an **interrupted** run. The script does not automatically recover interrupted runs; inspect the journal and use a backup/manual recovery. Windows file locks, antivirus, power loss, or other processes may cause interruptions.
- Avoid editing/moving files between preview and rename. The operation creates a fresh plan when it runs.
- Beware renaming program files, application data, linked resources, or documents referenced by other software: changing their names can break references.

## Multiple independent folders (v2)

Instead of a single `folderPath`, set `folders` to an array. Each folder has its own renaming configuration, so you can rename any number of separate directories in **one** `node index.js rename` run. Each entry can override `mode`, `newNames`, `renameMap`, `random`, `autoNumber`, `extensions` and `recursive`. Values not specified in an entry inherit the top-level defaults.

```js
module.exports = {
  recursive: true,
  preserveExtension: true,
  folders: [
    { folderPath: String.raw`C:\Work\Shoes`, mode: 'sequential', newNames: ['Red', 'Blue'] },
    { folderPath: String.raw`D:\Reports`, mode: 'specific', renameMap: [{oldName:'draft.pdf',newName:'final.pdf'}] },
    { folderPath: String.raw`E:\Archive`, mode: 'autoNumber', autoNumber: {prefix:'Archive_',start:1,padding:3} }
  ]
};
```

Run `node index.js scan`, then `node index.js preview`, review `output/preview.json`, and run `node index.js rename`. `node index.js undo` restores the latest completed multi-folder batch when there are no conflicts. Every sequential folder requires exactly as many new names as eligible files **in that folder** (including nested files when `recursive: true`).

**Safety:** Folder paths must be distinct and non-overlapping; avoid including a parent and its child in the same batch. If you intend to rename nested folders as one collection, use the parent path with `recursive: true`. Never include the tool's own project/output directory among rename targets. Reports and undo journal live in the tool's `output` directory; keep this folder intact for recovery. Back up important files before running.
