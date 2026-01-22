import { EventEmitter } from 'node:events'
import { app } from 'electron'
import is from 'electron-is'

import ExceptionHandler from './core/ExceptionHandler'
import logger from './core/Logger'
import Application from './Application'
import {
  splitArgv,
  parseArgvAsUrl,
  parseArgvAsFile,
  parseArgvAsDownloadTask,
  hasHelpOption,
  showHelp
} from './utils'
import { EMPTY_STRING } from '@shared/constants'

export default class Launcher extends EventEmitter {
  constructor () {
    super()
    this.url = EMPTY_STRING
    this.file = EMPTY_STRING
    this.downloadTasks = []
    this.downloadOptions = {}

    this.makeSingleInstance(() => {
      this.init()
    })
  }

  makeSingleInstance (callback) {
    // Mac App Store Sandboxed App not support requestSingleInstanceLock
    if (is.mas()) {
      callback && callback()
      return
    }

    const gotSingleLock = app.requestSingleInstanceLock()

    if (!gotSingleLock) {
      logger.info('[Motrix] another instance is running, quitting...')
      app.quit()
    } else {
      app.on('second-instance', (event, argv, workingDirectory) => {
        logger.info('[Motrix] second instance detected, showing main window...')
        if (global.application) {
          global.application.showPage('index')
          // 处理第二个实例的命令行参数，在所有平台上都处理
          if (argv.length > 1) {
            logger.info('[Motrix] handling second instance argv:', argv)
            this.handleAppLaunchArgv(argv)
          }
        }
      })

      callback && callback()
    }
  }

  init () {
    this.exceptionHandler = new ExceptionHandler()

    this.openedAtLogin = is.macOS()
      ? app.getLoginItemSettings().wasOpenedAtLogin
      : false

    // 检查命令行参数是否有帮助选项，如果有则显示帮助信息并退出
    if (process.argv.length > 1 && hasHelpOption(process.argv)) {
      showHelp()
      app.quit()
      return
    }

    if (process.argv.length > 1) {
      this.handleAppLaunchArgv(process.argv)
    }

    logger.info('[Motrix] openedAtLogin:', this.openedAtLogin)

    this.handleAppEvents()
  }

  handleAppEvents () {
    this.handleRendererRemote()
    this.handleOpenUrl()
    this.handleOpenFile()

    this.handelAppReady()
    this.handleAppWillQuit()
  }

  handleRendererRemote () {
    app.on('browser-window-created', (_, window) => {
      require('@electron/remote/main').enable(window.webContents)
    })
  }

  /**
   * handleOpenUrl
   * Event 'open-url' macOS only
   * "name": "Motrix Protocol",
   * "schemes": ["mo", "motrix"]
   */
  handleOpenUrl () {
    if (is.mas() || !is.macOS()) {
      return
    }
    app.on('open-url', (event, url) => {
      logger.info(`[Motrix] open-url: ${url}`)
      event.preventDefault()
      this.url = url
      this.sendUrlToApplication()
    })
  }

  /**
   * handleOpenFile
   * Event 'open-file' macOS only
   * handle open torrent file
   */
  handleOpenFile () {
    if (!is.macOS()) {
      return
    }
    app.on('open-file', (event, path) => {
      logger.info(`[Motrix] open-file: ${path}`)
      event.preventDefault()
      this.file = path
      this.sendFileToApplication()
    })
  }

  /**
   * handleAppLaunchArgv
   * For Windows, Linux
   * @param {array} argv
   */
  handleAppLaunchArgv (argv) {
    logger.info('[Motrix] handleAppLaunchArgv:', argv)

    // 检查是否有帮助选项
    if (hasHelpOption(argv)) {
      showHelp()
      app.quit()
      return
    }

    // args: array, extra: map
    const { args, extra } = splitArgv(argv)
    logger.info('[Motrix] split argv args:', args)
    logger.info('[Motrix] split argv extra:', extra)
    if (extra['--opened-at-login'] === '1') {
      this.openedAtLogin = true
    }

    // 解析下载任务
    const { tasks, options } = parseArgvAsDownloadTask(argv)
    logger.info('[Motrix] parsed download tasks:', tasks)
    logger.info('[Motrix] parsed options:', options)

    if (tasks.length > 0) {
      this.downloadTasks = tasks
      this.downloadOptions = options
      this.sendDownloadTasksToApplication()
      return
    }

    const file = parseArgvAsFile(args)
    if (file) {
      this.file = file
      this.sendFileToApplication()
    }

    const url = parseArgvAsUrl(args)
    if (url) {
      this.url = url
      this.sendUrlToApplication()
    }
  }

  sendUrlToApplication () {
    if (this.url && global.application && global.application.isReady) {
      global.application.handleProtocol(this.url)
      this.url = EMPTY_STRING
    }
  }

  sendFileToApplication () {
    if (this.file && global.application && global.application.isReady) {
      global.application.handleFile(this.file)
      this.file = EMPTY_STRING
    }
  }

  sendDownloadTasksToApplication () {
    if (this.downloadTasks.length > 0 && global.application && global.application.isReady) {
      global.application.handleDownloadTasks(this.downloadTasks, this.downloadOptions)
      this.downloadTasks = []
      this.downloadOptions = {}
    }
  }

  handelAppReady () {
    app.on('ready', () => {
      global.application = new Application()

      const { openedAtLogin } = this
      global.application.start('index', {
        openedAtLogin
      })

      global.application.on('ready', () => {
        this.sendUrlToApplication()
        this.sendFileToApplication()
        this.sendDownloadTasksToApplication()
      })
    })

    app.on('activate', () => {
      if (global.application) {
        logger.info('[Motrix] activate')
        global.application.showPage('index')
      }
    })
  }

  handleAppWillQuit () {
    app.on('will-quit', () => {
      logger.info('[Motrix] will-quit')
      if (global.application) {
        logger.info('[Motrix] will-quit.application.stop')
        global.application.stop()
      }
    })
  }
}
