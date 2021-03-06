// ----------------------------------------------------------------------------
//  See LICENSE.md file
// ----------------------------------------------------------------------------
'use strict';

const colors = require('colors/safe');
const path = require('path');
const fs = require('fs');

exports.detectProject = function(compile_path, runCmd, command) {
  var detected = null;
  if (runCmd == 'micro-python' || runCmd == 'micropython') {
    detected = {
      'toolchain': 'micro-python'
    };
  }
  return detected;
};

exports.selfCall = function(config, runCmd, command, compile_path) {
  return exports.buildCommands(config, runCmd, 'compile', compile_path).run;
};

exports.createExtension = function() {
  return {
    run : `
    RUN apt-get update
    RUN apt-get install -y build-essential libreadline-dev libffi-dev git pkg-config && apt clean
    RUN mkdir /tools && cd /tools \
      && git clone --recurse-submodules https://github.com/micropython/micropython.git \
      && cd ./micropython/ports/unix \
      && make axtls \
      && make
    RUN ln -s /tools/micropython/ports/unix/micropython /usr/bin/micropython
`,
    callback: null
  };
};

exports.addFeatures = function(config, runCmd, command, compile_path) {
  if (command == 'upip') {
    return {
      run: 'RUN micropython -m upip ' + (runCmd != -1 ? runCmd : ''),
      callback: null,
      commitChanges: true
    };
  } else if (command == 'micropython') {
    return exports.buildCommands(config, runCmd, 'compile', compile_path);
  }
};

exports.buildCommands = function mpBuild(config, runCmd, command, compile_path, mount_path) {
  var callback = null;
  var runString = '';

  if (command == 'init') {
    // noop
  } else if (command == 'localFolderContainerConstructer') {
    // noop
  } else if (command == 'clean') {
    // noop
  } else if (command == 'compile') {
    runString = 'micropython ' + (runCmd != -1 ? runCmd : '');
  } else if (command == 'export') {
    // noop
    process.exit(0);
  } else {
    console.error(' -', colors.bold('error :'),
      'Unknown command', command);
    process.exit(1);
  }

  return {
    run: runString,
    callback: callback
  };
};

exports.createProject = function createProject(compile_path, runCmd) {
  var args = typeof runCmd === 'string' ? runCmd.split(' ') : [];

  var projectName;
  if (args.length) {
    projectName = args[0];
  }

  var target_folder;
  if (projectName) {
    target_folder = path.join(compile_path, projectName);
    try {
      fs.mkdirSync(target_folder);
    } catch(e) {
      if (!fs.existsSync(target_folder)) {
        console.error(' -', colors.bold('error:'), 'cant\'t create folder', projectName);
        process.exit(1);
      }
    }
  } else {
    target_folder = compile_path;
    projectName = 'sampleApplication';
  }

  var config = `
{
  "name":"${projectName}",
  "toolchain":"micro-python"
}
`;

  fs.writeFileSync(path.join(target_folder, `${projectName}.py`), 'print(\'hello\')');
  fs.writeFileSync(path.join(target_folder, 'iotz.json'), config);
  console.log(' -', colors.bold('done!'));
};