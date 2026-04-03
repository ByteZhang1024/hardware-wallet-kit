/* eslint-disable @typescript-eslint/no-var-requires */
require('dotenv').config();
const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');

const config = require('./monitor-config.json');

const targetDir = process.env[config.targetEnvVar];

if (!targetDir) {
  console.error(
    `Target directory ${config.targetEnvVar} is not set. Please specify it in the .env file.`
  );
  process.exit(1);
}

const { basePath, projects, specialProjects } = config;

const watchPaths = projects.flatMap(project => {
  const watchDirs = specialProjects[project] || [config.defaultWatchDir];
  return watchDirs.map(dir => {
    const dirPath = path.join(basePath, project, dir);
    console.log('Watching:', dirPath);
    return dirPath;
  });
});

function copyFile(src, dest, ignoreLog) {
  fs.copy(src, dest, { overwrite: true })
    .then(() => {
      if (!ignoreLog) {
        console.log(`Copied ${src} → ${dest}`);
      }
    })
    .catch(err => console.error(`Error copying ${src}:`, err));
}

const watcher = chokidar.watch(watchPaths, {
  ignored: [
    /(^|[\/\\])\./,
    ...config.ignoredPaths.map(p => `**/${p}/**`),
  ],
  persistent: true,
});

async function handleFileEvent(filePath, eventType) {
  const relativePath = path.relative(basePath, filePath);
  const parts = relativePath.split(path.sep);
  const projectName = parts[0];

  if (!projects.includes(projectName)) {
    return;
  }

  const packageJsonPath = path.join(basePath, projectName, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    const packageJson = await fs.readJson(packageJsonPath);
    const packageName = packageJson.name;

    // relativePath: "core/dist/index.js" → destPath: "node_modules/@bytezhang/hardware-wallet-core/dist/index.js"
    const withinProject = parts.slice(1).join(path.sep); // "dist/index.js"
    const destPath = path.join(targetDir, 'node_modules', packageName, withinProject);

    try {
      if (eventType === 'delete') {
        await fs.remove(destPath);
        console.log(`Removed ${destPath}`);
      } else {
        copyFile(filePath, destPath, eventType === 'add');
      }
    } catch (err) {
      console.error(`Error handling ${filePath}:`, err);
    }
  }
}

watcher
  .on('add', filePath => handleFileEvent(filePath, 'add'))
  .on('change', filePath => handleFileEvent(filePath, 'change'))
  .on('unlink', filePath => handleFileEvent(filePath, 'delete'))
  .on('error', error => console.error(`Watcher error: ${error}`))
  .on('ready', () => console.log('Ready. Watching for changes...'));

process.on('SIGINT', () => {
  console.log('Closing watcher...');
  watcher.close();
  process.exit(0);
});
