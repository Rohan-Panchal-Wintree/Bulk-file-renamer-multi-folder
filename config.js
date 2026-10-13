// Each folder can use its own mode, name array, or exact mapping.
// Paths must be distinct and must NOT be nested inside another selected folder.
module.exports = {
  recursive: true,
  preserveExtension: true,
  extensions: [], // [] = every file type
  mode: 'sequential', // specific | sequential | random | autoNumber
  renameMap: [],
  newNames: [],
  random: { prefix: 'FILE_', length: 8 },
  autoNumber: { prefix: 'Document_', start: 1, padding: 3 },

  folders: [
    {
      folderPath: String.raw`C:\Users\YourName\Documents\Folder_A`,
      mode: 'sequential',
      newNames: ['Product_A', 'Product_B']
    },
    {
      folderPath: String.raw`C:\Users\YourName\Documents\Folder_B`,
      mode: 'specific',
      renameMap: [{ oldName: 'ABC.jpg', newName: 'XYZ.jpg' }]
    },
    {
      folderPath: String.raw`D:\OtherFiles`,
      mode: 'autoNumber',
      autoNumber: { prefix: 'Document_', start: 1, padding: 3 }
    }
  ]
};
