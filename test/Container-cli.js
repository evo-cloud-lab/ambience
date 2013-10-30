var Class    = require('js-class'),
    repl     = require('repl'),
    elements = require('evo-elements'),
    conf         = elements.Config.conf(),
    Logger       = elements.Logger,

    Container = require('../lib/Container');

var container = new Container(conf.query('id', 0), conf.query('container', {}), new Logger('CNTR', 'CLI'));

var COMMANDS = {
    load: function () {
        container.load();
        return COMMANDS.info();
    },

    unload: function () {
        container.unload();
        return COMMANDS.info();
    },

    start: function () {
        container.start();
        return COMMANDS.info();
    },

    stop: function (params) {
        var opts = {};
        opts.force = params.toLowerCase() == 'force';
        container.stop(opts);
        return COMMANDS.info();
    },

    status: function () {
        container.status();
        return COMMANDS.info();
    },

    info: function () {
        return {
            id: container.id,
            state: container.state,
            interior: container.interiorState,
            status: container.recentStatus
        };
    }
};

repl.start({
    prompt: 'container> ',
    ignoreUndefined: true,
    eval: function (cmd, context, filename, callback) {
        cmd = cmd.substr(1, cmd.length - 2).trim();
        var pos = cmd.indexOf(' '), command, params;
        if (pos > 0) {
            command = cmd.substr(0, pos).trim();
            params = cmd.substr(pos + 1).trim();
        } else {
            command = cmd.trim();
            params = '';
        }
        var fn = COMMANDS[command];
        if (fn == '') {
            callback(null, undefined);
        } else if (fn) {
            var value, err;
            try {
                value = fn(params);
            } catch (e) {
                err = e;
            }
            callback(err, value);
        } else {
            callback(new Error('Unknown command ' + command));
        }
    }
})
.on('exit', function () { process.exit(0); });
