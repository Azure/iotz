// ----------------------------------------------------------------------------
//  Copyright (C) Microsoft. All rights reserved.
//  Licensed under the MIT license.
// ----------------------------------------------------------------------------

const colors = require('colors/safe');
const fs     = require('fs');
const path   = require('path');
const rimraf = require('rimraf');
const exec        = require('child_process').exec;
const execSync   = require('child_process').execSync;
const extensions = require('../extensions/index.js');

function getProjectConfig(compile_path) {
  var proj_path = path.join(compile_path, "iotz.json");
  var config = null;
  try {
    config = JSON.parse(fs.readFileSync(proj_path) + "");
  } catch(e) { }

  if (!config) {
    config = extensions.autoDetectToolchain(compile_path);
  } else if (!config.toolchain) {
    var config_detected = extensions.autoDetectToolchain(compile_path);
    if (config_detected && config_detected.toolchain) {
      config.toolchain = config_detected.toolchain;
    }
  }

  return config;
}

function createImage(args, compile_path, config, callback) {
  var images = execSync('docker images -a');
  var ino = fs.statSync(compile_path).ino;
  var container_name = "aiot_iotz_" + ino;

  var command = args.getCommand();
  var runCmd = args.get(command);

  if (command == 'clean' && !config) {
    callback(0);
    return;
  }

  // do we have the local container?
  if (images.indexOf("azureiot/iotz_local") == -1) {
    require('../extensions/index.js').createLocalContainer();
  }

  // do we have the project container
  if (images.indexOf(container_name) == -1 || command == 'init') {
    if (command == 'connect') {
      console.error(" -", colors.red('error:'), "there wasn't any project 'initialized' on this path.");
      console.error('  ', "try 'iotz init' ?");
      process.exit(1);
    }

    console.log(" -", colors.yellow('initializing the project container..'));

    var ret;
    var config = getProjectConfig(compile_path);

    if (config) {
      if (!config.toolchain) {
        console.error(" -", colors.red('warning:'), "no 'toolchain' is defined under iotz.json.");
      } else {
        ret = extensions.requireExtension(extensions.getToolchain(config.toolchain))
          .build(config, runCmd, 'container_init', compile_path);

        if (ret && ret.run.length) {
          runCmd = "&& " + ret.run;
        }
      }
    }

    var libs = `
    FROM azureiot/iotz_local

    WORKDIR /src/program

    RUN echo "Setting up ${container_name}" ${runCmd}`;
    fs.writeFileSync(path.join(compile_path, 'Dockerfile'), libs);

    var batchString = `docker build . --force-rm -t ${container_name}`;
    var subProcess = exec(`cd ${compile_path} && ` + batchString);

    subProcess.stderr.pipe(process.stderr);
    subProcess.stdin.pipe(process.stdin);

    subProcess.on('exit', function(errorCode) {
      rimraf.sync(path.join(compile_path, 'Dockerfile'));
      if (ret && ret.callback) {
        ret.callback(config);
      }
      callback(errorCode);
    });
  } else {
    callback(0);
  }
}

var active_instance = null;
function runCommand(args, compile_path, CMD, callback) {
  var ino = fs.statSync(compile_path).ino;
  var container_name = "aiot_iotz_" + ino;
  active_instance = container_name + "_";
  try {
    // clean up the previously stopped instance
    execSync(`docker container rm -f "/${active_instance}" 2>&1`);
  } catch(e) { }

  var batchString = `\
docker run --rm --name ${active_instance} -t --volume \
${compile_path}:/src/program:rw,cached ${container_name} /bin/bash -c "${CMD}"\
`;

  var subProcess = exec(`cd ${compile_path} && ${batchString}`);
  subProcess.stdout.pipe(process.stdout);
  subProcess.stderr.pipe(process.stderr);
  subProcess.stdin.pipe(process.stdin);

  subProcess.on('exit', function(errorCode) {
    callback(errorCode);
  });
}

process.on('SIGINT', function() {
  if (active_instance) {
    // make sure container will stop
    try {
      execSync(`docker kill ${active_instance} 2>&1`);
    } catch(e) { }
  }
  process.exit();
});

exports.cleanCommon = function(compile_path) {
  var ino = fs.statSync(compile_path).ino;
  var container_name = "aiot_iotz_" + ino;
  try {
    // clean up the previously stopped instance
    execSync(`docker image rm -f ${container_name} 2>&1`);
  } catch(e) { }
  console.log(' -', colors.green('container is deleted'));
};

exports.build = function makeBuild(args, compile_path) {
  var command = args.getCommand();
  var config = getProjectConfig(compile_path)

  createImage(args, compile_path, config, function(errorCode) {
    var runCmd = args.get(command);

    switch(command) {
      case "init":
      case "compile":
      case "clean":
      case "export":
      {
        if (command == 'init' && process.platform === "win32") {
          // TODO: detect this and behave accordingly?
          console.log(colors.yellow('Have you shared the current drive on Docker for Windows?'));
        }

        if (!config) {
          if (command == 'clean') {
            exports.cleanCommon(compile_path);
            return;
          }
          console.error(" -", colors.red('error :'), "iotz.json file is needed. try 'iotz help'");
          process.exit(1);
        }

        if (!config.hasOwnProperty('toolchain')) {
          if (command == 'clean') {
            exports.cleanCommon(compile_path);
            return;
          }
          console.error(' - error:', colors.red('no toolchain is defined. i.e. "toolchain":"arduino" or "toolchain":"mbed" etc..'));
          process.exit(1);
        }

        var ret;
        try {
          ret = extensions.requireExtension(extensions.getToolchain(config.toolchain))
                .build(config, runCmd, command, compile_path);
        } catch(e) {
          console.error(' - error:', "something bad happened..\n", colors.red(e));
          process.exit(1);
        }
      }
      break;
      case "run": // do nothing
      break;
      case "connect":
        {
          try {
            var ino = fs.statSync(compile_path).ino;
            var container_name = "aiot_iotz_" + ino;
            execSync(`docker run -ti -v ${compile_path}:/src/program ${container_name}`, {stdio:[0,1,2]});
          } catch(e) {
            console.error(" -", colors.red('error:'), "something went wrong");
            console.error("  ", e);
            process.exit(1);
          }
        }
      break;
      case "make":
        runCmd = command + " " + (runCmd != -1 ? runCmd : "");
        break;
      default:
        if (extensions.getToolchain(command, 1) == command) {
          runCmd = extensions.requireExtension(extensions.getToolchain(command))
                   .directCall(config, runCmd, command, compile_path);
        } else {
          console.error(" - error:", colors.red('unknown command'), command, compile_path);
          process.exit(1);
        }
    };

    if (ret && typeof ret.run === 'string') {
      runCmd = ret.run;
    }

    if (runCmd === -1) {
      console.error(` - error: you should provide a command to run after "${command}".`);
      errorCode = errorCode ? errorCode : 1;
    }

    if (errorCode) {
      process.exit(errorCode);
      return;
    }

    runCommand(args, compile_path, runCmd, function(errorCode) {
      if (errorCode) {
        process.exit(errorCode);
        return;
      }
      if (ret && ret.callback) {
        ret.callback(config);
      }
      if (command == 'clean') {
        exports.cleanCommon(compile_path);
      }
    })
  });
} // mbedBuild