import { resolve } from 'node:path'
import { access, constants, existsSync, lstatSync } from 'node:fs'
import { app, nativeTheme, shell } from 'electron'
import is from 'electron-is'

import {
  APP_THEME,
  ENGINE_MAX_CONNECTION_PER_SERVER,
  IP_VERSION,
  IS_PORTABLE,
  PORTABLE_EXECUTABLE_DIR
} from '@shared/constants'
import { engineBinMap, engineArchMap } from '../configs/engine'
import logger from '../core/Logger'

export const getUserDataPath = () => {
  return IS_PORTABLE ? PORTABLE_EXECUTABLE_DIR : app.getPath('userData')
}

export const getSystemLogPath = () => {
  return app.getPath('logs')
}

export const getUserDownloadsPath = () => {
  return app.getPath('downloads')
}

export const getConfigBasePath = () => {
  const path = getUserDataPath()
  return path
}

export const getSessionPath = () => {
  return resolve(getUserDataPath(), './download.session')
}

export const getEnginePidPath = () => {
  return resolve(getUserDataPath(), './engine.pid')
}

export const getDhtPath = (protocol) => {
  const name = protocol === IP_VERSION.V6 ? 'dht6.dat' : 'dht.dat'
  return resolve(getUserDataPath(), `./${name}`)
}

export const getEngineBin = (platform) => {
  const result = engineBinMap[platform] || ''
  return result
}

export const getEngineArch = (platform, arch) => {
  if (!['darwin', 'win32', 'linux'].includes(platform)) {
    return ''
  }

  const result = engineArchMap[platform][arch]
  return result
}

export const getDevEnginePath = (platform, arch) => {
  const ah = getEngineArch(platform, arch)
  const base = `../../../extra/${platform}/${ah}/engine`
  const result = resolve(__dirname, base)
  return result
}

export const getProdEnginePath = () => {
  return resolve(app.getAppPath(), '../engine')
}

export const getEnginePath = (platform, arch) => {
  return is.dev() ? getDevEnginePath(platform, arch) : getProdEnginePath()
}

export const getAria2BinPath = (platform, arch) => {
  const base = getEnginePath(platform, arch)
  const binName = getEngineBin(platform)
  const result = resolve(base, `./${binName}`)
  return result
}

export const getAria2ConfPath = (platform, arch) => {
  const base = getEnginePath(platform, arch)
  return resolve(base, './aria2.conf')
}

export const transformConfig = (config) => {
  const result = []
  for (const [k, v] of Object.entries(config)) {
    if (v !== '') {
      result.push(`--${k}=${v}`)
    }
  }
  return result
}

export const isRunningInDmg = () => {
  if (!is.macOS() || is.dev()) {
    return false
  }
  const appPath = app.getAppPath()
  const result = appPath.startsWith('/Volumes/')
  return result
}

export const moveAppToApplicationsFolder = (errorMsg = '') => {
  return new Promise((resolve, reject) => {
    try {
      const result = app.moveToApplicationsFolder()
      if (result) {
        resolve(result)
      } else {
        reject(new Error(errorMsg))
      }
    } catch (err) {
      reject(err)
    }
  })
}

export const splitArgv = (argv) => {
  const args = []
  const extra = {}
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const kv = arg.split('=')
      const key = kv[0]
      const value = kv[1] || '1'
      extra[key] = value
      continue
    }
    args.push(arg)
  }
  return { args, extra }
}

export const showHelp = () => {
  console.log('\nMotrix 命令行帮助信息\n')
  console.log('使用方法:')
  console.log('  motrix [选项] <下载链接或文件>\n')
  console.log('选项:')
  console.log('  -h, --help         显示帮助信息')
  console.log('  --dir <路径>       指定下载目录（不存在会自动创建）')
  console.log('  --output <路径>    同 --dir，指定下载目录')
  console.log('  --silent           自动确认下载，无需手动点击确认按钮\n')
  console.log('支持的下载任务类型:')
  console.log('  1. 单个下载链接       motrix https://example.com/file.zip')
  console.log('  2. 多个下载链接       motrix https://example.com/file1.zip https://example.com/file2.zip')
  console.log('  3. 批量下载列表文件    motrix --dir D:\\Downloads urls.txt')
  console.log('  4. 种子文件           motrix --dir D:\\Downloads example.torrent')
  console.log('  5. 磁力链            motrix --dir D:\\Downloads magnet:?xt=urn:btih:...\n')
  console.log('示例:')
  console.log('  motrix --dir D:\\Downloads https://example.com/file.zip')
  console.log('  motrix --silent urls.txt\n')
}

export const hasHelpOption = (argv) => {
  return argv.includes('-h') || argv.includes('--help') || argv.includes('/?')
}

export const parseArgvAsDownloadTask = (argv) => {
  const tasks = []
  const options = {}

  let i = 1
  while (i < argv.length) {
    const arg = argv[i]

    if (arg === '-h' || arg === '--help' || arg === '/?') {
      // 忽略帮助选项，在调用处处理
      options.help = true
    } else if (arg.startsWith('--')) {
      const kv = arg.split('=')
      const key = kv[0].substring(2)
      let value = kv[1] || '1'

      // 处理不带等号的选项值，如 --dir C:\Downloads
      if (value === '1' && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        value = argv[i + 1]
        i++
      }

      options[key] = value
    } else if (arg.endsWith('.txt')) {
      // 批量下载列表文件
      tasks.push({ type: 'list', path: arg })
    } else if (checkIsSupportedSchema(arg)) {
      // 单个下载链接
      tasks.push({ type: 'url', url: arg })
    } else {
      // 可能是种子文件
      tasks.push({ type: 'file', path: arg })
    }
    i++
  }

  return { tasks, options }
}

export const parseArgvAsUrl = (argv) => {
  const arg = argv[1]
  if (!arg) {
    return
  }

  if (checkIsSupportedSchema(arg)) {
    return arg
  }
}

export const checkIsSupportedSchema = (url = '') => {
  const str = url.toLowerCase()
  if (
    str.startsWith('ftp:') ||
    str.startsWith('http:') ||
    str.startsWith('https:') ||
    str.startsWith('magnet:') ||
    str.startsWith('thunder:') ||
    str.startsWith('mo:') ||
    str.startsWith('motrix:')
  ) {
    return true
  } else {
    return false
  }
}

export const isDirectory = (path) => {
  return existsSync(path) && lstatSync(path).isDirectory()
}

export const parseArgvAsFile = (argv) => {
  let arg = argv[1]
  if (!arg || isDirectory(arg)) {
    return
  }

  if (is.linux()) {
    arg = arg.replace('file://', '')
  }
  return arg
}

export const getMaxConnectionPerServer = () => {
  return ENGINE_MAX_CONNECTION_PER_SERVER
}

export const getSystemTheme = () => {
  let result = APP_THEME.LIGHT
  result = nativeTheme.shouldUseDarkColors ? APP_THEME.DARK : APP_THEME.LIGHT
  return result
}

export const convertArrayBufferToBuffer = (arrayBuffer) => {
  const buffer = Buffer.alloc(arrayBuffer.byteLength)
  const view = new Uint8Array(arrayBuffer)
  for (let i = 0; i < buffer.length; ++i) {
    buffer[i] = view[i]
  }
  return buffer
}

export const showItemInFolder = (fullPath) => {
  if (!fullPath) {
    return
  }

  fullPath = resolve(fullPath)
  access(fullPath, constants.F_OK, (err) => {
    if (err) {
      logger.warn(`[Motrix] ${fullPath} ${err ? 'does not exist' : 'exists'}`)
      return
    }

    shell.showItemInFolder(fullPath)
  })
}
