var async = require('async'),
    Config = require('evo-elements').Config;

var SERVICE = 'ambience';

var cli;

function request(neuron, msg, next) {
    cli.log(cli.verb('Request'));
    cli.logObject(msg);
    neuron.request(SERVICE, msg, function (err, resp) {
        err && cli.fatal(err);
        cli.log(cli.verb('Response'));
        cli.logObject(resp);
        next ? next(resp, neuron) : process.exit(0);
    });
}

function execute(event, data, opts, next) {
    cli.neuronConnectService(SERVICE, opts, function (neuron) {
        request(neuron, { event: event, data: data }, next);
    });
}

function createContainer(opts) {
    var cfg = new Config();
    cfg.parse(['--container=' + opts.CONFIG]);
    execute('container.create', { id: opts.ID, conf: cfg.opts.container }, opts);
}

function destroyContainer(opts) {
    execute('container.destroy', { id: opts.ID }, opts);
}

function startContainer(opts) {
    execute('container.start', { id: opts.ID }, opts);
}

function stopContainer(opts) {
    execute('container.stop', { id: opts.ID, force: opts.force }, opts);
}

function listContainers(opts) {
    execute('container.list', {}, opts, function (msg, neuron) {
        var ids = Array.isArray(msg.data.ids) ? msg.data.ids : [];
        var infos = {};
        async.each(ids, function (id, next) {
            neuron.request(SERVICE, { event: 'container.query', data: { id: id } }, function (err, resp) {
                infos[id] = err || resp.data;
                next();
            });
        }, function () {
            for (var id in infos) {
                var info = infos[id];
                if (info == null) {
                    cli.log(cli.live(id) + ' ' + cli.lo('null'));
                } else {
                    cli.log(cli.live(id));
                    if (info instanceof Error) {
                        cli.log(cli.err('ERROR ' + info.message));
                    } else {
                        delete info.id;
                        cli.logObject(info, {}, 1);
                    }
                }
            }
            process.exit(0);
        });
    });
}

function queryContainer(opts) {
    execute('container.query', { id: opts.ID }, opts);
}

function logState(msg) {
    cli.log(cli.verb('STATE') + ' ' + msg.data.id + ':' + ' ' + cli.lo(msg.data.lastState) + ' -> ' + cli.hi(msg.data.state));
}

function logStatus(msg) {
    cli.log(cli.verb('STATUS') + ' ' + msg.data.id);
    cli.logObject(msg.data);
}

function logError(msg) {
    cli.log(cli.err('ERROR') + ' ' + msg.data.id)
    cli.logObject(msg.data);
}

function monitorContainers(opts) {
    cli.neuronConnectService(SERVICE, opts, function (neuron) {
        neuron
            .subscribe('container.state', SERVICE, logState)
            .subscribe('container.status', SERVICE, logStatus)
            .subscribe('container.error', SERVICE, logError);
    });
}

module.exports = function (theCli) {
    cli = theCli;

    cli.neuronCmd('amb:create', function (cmd) {
        cmd.help('Create a container')
            .option('ID', {
                type: 'string',
                position: 1,
                required: true,
                help: 'Container Id'
            })
            .option('CONFIG', {
                type: 'string',
                position: 2,
                required: true,
                help: 'Configuration'
            });
    }, createContainer);

    cli.neuronCmd('amb:destroy', function (cmd) {
        cmd.help('Destroy a container')
            .option('ID', {
                type: 'string',
                position: 1,
                required: true,
                help: 'Container Id'
            });
    }, destroyContainer);

    cli.neuronCmd('amb:start', function (cmd) {
        cmd.help('Start a container')
            .option('ID', {
                type: 'string',
                position: 1,
                required: true,
                help: 'Container Id'
            });
    }, startContainer);

    cli.neuronCmd('amb:stop', function (cmd) {
        cmd.help('Stop a container')
            .option('ID', {
                type: 'string',
                position: 1,
                required: true,
                help: 'Container Id'
            })
            .option('force', {
                abbr: 'f',
                type: 'boolean',
                default: false,
                help: 'Stop the container immediately'
            });
    }, stopContainer);

    cli.neuronCmd('amb:list', function (cmd) {
        cmd.help('List all containers');
    }, listContainers);

    cli.neuronCmd('amb:info', function (cmd) {
        cmd.help('Get container info')
            .option('ID', {
                type: 'string',
                position: 1,
                required: true,
                help: 'Container Id'
            });
    }, queryContainer);

    cli.neuronCmd('amb:monitor', function (cmd) {
        cmd.help('Monitor connector status');
    }, monitorContainers);
};
