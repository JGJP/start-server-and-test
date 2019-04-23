'use strict'

const la = require('lazy-ass')
const is = require('check-more-types')
const execa = require('execa')
const waitOn = require('wait-on')
const Promise = require('bluebird')
const psTree = require('ps-tree')
const debug = require('debug')('start-server-and-test')

const isDebug = () =>
  process.env.DEBUG && process.env.DEBUG.indexOf('start-server-and-test') !== -1

const isInsecure = () => process.env.START_SERVER_AND_TEST_INSECURE

function startAndTest ({ start, url, test }) {
  la(is.unemptyString(start), 'missing start script name', start)
  la(is.unemptyString(test), 'missing test script name', test)
  la(
    is.unemptyString(url) || is.unemptyArray(url),
    'missing url to wait on',
    url
  )

  debug('starting server, verbose mode?', isDebug())

  const startCommand = 'npm run start'
  const server = execa.shell(startCommand, { stdio: 'inherit' })
  let serverStopped

  function stopServer () {
    debug('getting child processes')
    if (!serverStopped) {
      serverStopped = true
      return Promise.fromNode(cb => psTree(server.pid, cb))
        .then(children => {
          debug('stopping child processes')
          children.forEach(child => {
            try {
              process.kill(child.PID, 'SIGINT')
            } catch (e) {
              if (e.code === 'ESRCH') {
                console.log(
                  `Child process ${child.PID} exited before trying to stop it`
                )
              } else {
                throw e
              }
            }
          })
        })
        .then(() => {
          debug('stopping server')
          server.kill()
        })
    }
  }

  const waited = new Promise((resolve, reject) => {
    const onClose = () => {
      reject(new Error('server closed unexpectedly'))
    }

    server.on('close', onClose)

    debug('starting waitOn %s', url)
    waitOn(
      {
        resources: Array.isArray(url) ? url : [url],
        interval: 2000,
        window: 1000,
        verbose: isDebug(),
        strictSSL: !isInsecure(),
        log: isDebug()
      },
      err => {
        if (err) {
          debug('error waiting for url', url)
          debug(err.message)
          return reject(err)
        }
        debug('waitOn finished successfully')
        server.removeListener('close', onClose)
        resolve()
      }
    )
  })

  function runTests () {
    const testCommand = `npm run ${test}`
    debug('running test script command: %s', testCommand)
    return execa.shell(testCommand, { stdio: 'inherit' })
  }

  return waited
    .tapCatch(stopServer)
    .then(runTests)
    .finally(stopServer)
}

module.exports = startAndTest
