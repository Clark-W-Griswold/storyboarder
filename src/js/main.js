const {app, ipcMain, BrowserWindow, globalShortcut, dialog, powerSaveBlocker} = electron = require('electron')

const fs = require('fs')
const path = require('path')
const isDev = require('electron-is-dev')

const prefModule = require('./prefs')

const fountain = require('./vendor/fountain')
const fountainDataParser = require('./fountain-data-parser')
const fountainSceneIdUtil = require('./fountain-scene-id-util')

let welcomeWindow
let newWindow

let mainWindow
let sketchWindow
let welcomeInprogress
let stsWindow

let statWatcher

let powerSaveId = 0

let previousScript

let prefs = prefModule.getPrefs()

let currentFile
let currentPath

global.sharedObj = { 'prefs': prefs }

app.on('ready', ()=> {
  // via https://github.com/electron/electron/issues/4690#issuecomment-217435222
  const argv = process.defaultApp ? process.argv.slice(2) : process.argv

  // was an argument passed?
  if (isDev && argv[0]) {
    let filePath = path.resolve(argv[0])
    if (fs.existsSync(filePath)) {
      openFile(filePath)
      return

    } else {
      console.error('Could not load', filePath)
    }
  }

  // open the welcome window when the app loads up first
  //openWelcomeWindow()
  openStsWindow()
})

app.on('activate', ()=> {
  if (!mainWindow && !welcomeWindow) openWelcomeWindow()
  
})

let openNewWindow = () => {
  if (!newWindow) {
    newWindow = new BrowserWindow({width: 600, height: 580, show: false, center: true, parent: welcomeWindow, resizable: false, frame: false, modal: true})
    newWindow.loadURL(`file://${__dirname}/../new.html`)
    newWindow.once('ready-to-show', () => {
      newWindow.show()
    })
  }
  newWindow.show()
}

let openStsWindow = () => {
  console.log("sts")
  if (!stsWindow) {
    stsWindow = new BrowserWindow({width: 600, height: 580, show: false, center: true, resizable: false, frame: false, modal: false})
    stsWindow.loadURL(`file://${__dirname}/../sts-window.html`)
    stsWindow.once('ready-to-show', () => {
      stsWindow.show()
    })
  }
  stsWindow.show()
}


let openWelcomeWindow = ()=> {
  // RESET PREFS - SHOULD BE COMMENTED OUT
  // console.log(prefs)
  // prefs = {scriptFile: `./outl3ine.txt`}
  // prefModule.savePrefs(prefs)
  welcomeWindow = new BrowserWindow({width: 900, height: 600, center: true, show: false, resizable: false, frame: false})
  welcomeWindow.loadURL(`file://${__dirname}/../welcome.html`)

  newWindow = new BrowserWindow({width: 600, height: 580, show: false, parent: welcomeWindow, resizable: false, frame: false, modal: true})
  newWindow.loadURL(`file://${__dirname}/../new.html`)

  let recentDocumentsCopy
  if (prefs.recentDocuments) {
    let count = 0
    recentDocumentsCopy = prefs.recentDocuments
    for (var recentDocument of prefs.recentDocuments) {
      try {
        fs.accessSync(recentDocument.filename, fs.F_OK);
      } catch (e) {
        // It isn't accessible
        console.log('error file no longer exists.')
        recentDocumentsCopy.splice(count, 1)
      }
      count++
    }
    prefs.recentDocuments = recentDocumentsCopy
  }

  welcomeWindow.once('ready-to-show', () => {
    setTimeout(()=>{welcomeWindow.show()}, 300)
  })

  welcomeWindow.once('close', () => {
    welcomeWindow = null
    if (!welcomeInprogress) {
      app.quit()
    } else {
      welcomeInprogress = false
    }
  })
}

let openFile = (file) => {
  let arr = file.split(path.sep)
  let filename = arr[arr.length-1]
  let filenameParts =filename.toLowerCase().split('.')
  let type = filenameParts[filenameParts.length-1]
  if (type == 'storyboarder') {
    /// LOAD STORYBOARDER FILE
    addToRecentDocs(file, {
      boards: 2,
      time: 3000,
    })
    loadStoryboarderWindow(file)
  } else if (type == 'fountain') {
    /// LOAD FOUNTAIN FILE
    fs.readFile(file, 'utf-8', (err,data)=>{
      sceneIdScript = fountainSceneIdUtil.insertSceneIds(data)
      if (sceneIdScript[1]) {
        dialog.showMessageBox({
          type: 'info',
          message: 'We added scene IDs to your fountain script.',
          detail: "Scene IDs are what we use to make sure we put the storyboards in the right place. If you have your script open in an editor, you should reload it. Also, you can change your script around as much as you want, but please don't change the scene IDs.",
          buttons: ['OK']
        })
        fs.writeFileSync(file, sceneIdScript[0])
        data = sceneIdScript[0]
      }
      // check for storyboards directory
      let storyboardsPath = file.split(path.sep)
      storyboardsPath.pop()
      storyboardsPath = path.join(storyboardsPath.join(path.sep), 'storyboards')
      if (!fs.existsSync(storyboardsPath)){
        fs.mkdirSync(storyboardsPath)
      }
      currentFile = file
      currentPath = storyboardsPath
      // check for storyboard.settings file
      let boardSettings
      if (!fs.existsSync(path.join(storyboardsPath, 'storyboard.settings'))){
        // pop dialogue ask for aspect ratio
        dialog.showMessageBox({
          type: 'question',
          buttons: ['Ultrawide: 2.39:1','Doublewide: 2.00:1','Wide: 1.85:1','HD: 16:9','Vertical HD: 9:16','Square: 1:1','Old: 4:3'],
          defaultId: 3,
          title: 'Which aspect ratio?',
          message: 'Which aspect ratio would you like to use?',
          detail: 'The aspect ratio defines the size of your boards. 2.35 is the widest, like what you would watch in a movie. 16x9 is what you would watch on a modern TV. 4x3 is what your grandpops watched back when screens flickered and programming was wholesome.',
        }, (response)=>{
          boardSettings = {lastScene: 0}
          let aspects = [2.39, 2, 1.85, 1.7777777777777777, 0.5625, 1, 1.3333333333333333]
          boardSettings.aspectRatio = aspects[response]
          fs.writeFileSync(path.join(storyboardsPath, 'storyboard.settings'), JSON.stringify(boardSettings))
          //[scriptData, locations, characters, metadata]
          let processedData = processFountainData(data, true, false)
          addToRecentDocs(currentFile, processedData[3])
          loadStoryboarderWindow(null, processedData[0], processedData[1], processedData[2], boardSettings, currentPath)
        })
      } else {
        boardSettings = JSON.parse(fs.readFileSync(path.join(storyboardsPath, 'storyboard.settings')))
        if (!boardSettings.lastScene) { boardSettings.lastScene = 0 }
        //[scriptData, locations, characters, metadata]
        let processedData = processFountainData(data, true, false)
        addToRecentDocs(currentFile, processedData[3])
        loadStoryboarderWindow(null, processedData[0], processedData[1], processedData[2], boardSettings, currentPath)
      }

    })
  }
}

let openDialogue = () => {
  dialog.showOpenDialog({title:"Open Script", filters:[
      {name: 'Screenplay or Storyboarder', extensions: ['fountain', 'storyboarder']},
    ]}, (filenames)=>{
      if (filenames) {
        openFile(filenames[0])
      }
  })
}

let processFountainData = (data, create, update) => {
  let scriptData = fountain.parse(data, true)
  let locations = fountainDataParser.getLocations(scriptData.tokens)
  let characters = fountainDataParser.getCharacters(scriptData.tokens)
  scriptData = fountainDataParser.parse(scriptData.tokens)
  let metadata = {type: 'script', sceneBoardsCount: 0, sceneCount: 0, totalMovieTime: 0}

  let boardsDirectoryFolders = fs.readdirSync(currentPath).filter(function(file) {
    return fs.statSync(path.join(currentPath, file)).isDirectory();
  });

  for (var node of scriptData) {
    switch (node.type) {
      case 'title':
        metadata.title = node.text.replace(/<(?:.|\n)*?>/gm, '')
        break
      case 'scene':
        metadata.sceneCount++
        let id 
        if (node.scene_id) {
          id = node.scene_id.split('-')
          if (id.length>1) {
            id = id[1]
          } else {
            id = id[0]
          }
        } else {
          id = 'G' + metadata.sceneCount
        }
        for (var directory in boardsDirectoryFolders) {
          if (directory.includes(id)) {
            metadata.sceneBoardsCount++
            // load board file and get stats and shit
            break
          }
        }
        break
    }
  }

  switch (scriptData[scriptData.length-1].type) {
    case 'section':
      metadata.totalMovieTime = scriptData[scriptData.length-1].time + scriptData[scriptData.length-1].duration
      break
    case 'scene':
      let lastNode = scriptData[scriptData.length-1]['script'][scriptData[scriptData.length-1]['script'].length-1]
      metadata.totalMovieTime = lastNode.time + lastNode.duration
      break
  }

  if (create) {
    fs.watchFile(currentFile, {persistent: false}, (e) => {
      console.log("TODO SHOULD LOAD FILE")
      //loadFile(false, true)
    })
  }

  if (update) {
    //let diffScene = getSceneDifference(previousScript, global.sharedObj['scriptData'])
    mainWindow.webContents.send('updateScript', 1)//, diffScene)
  }

  return [scriptData, locations, characters, metadata]
}

let getSceneDifference = (scriptA, scriptB) => {
  let i = 0
  for (var node of scriptB) {
    if(!scriptA[i]) {
      return i
    }
    if (JSON.stringify(node) !== JSON.stringify(scriptA[i])) {
      return i
    }
    i++
  }
  return false
}


////////////////////////////////////////////////////////////
// new functions
////////////////////////////////////////////////////////////

let createNew = () => {
  dialog.showSaveDialog({
    title:"New storyboard",
    buttonLabel: "Create",
  },
  (filename)=>{
    if (filename) {
      console.log(filename)
      let arr = filename.split(path.sep)
      let boardName = arr[arr.length-1]
      if (!fs.existsSync(filename)){
        fs.mkdirSync(filename)
        dialog.showMessageBox({
          type: 'question',
          buttons: ['Ultrawide: 2.39:1','Doublewide: 2.00:1','Wide: 1.85:1','HD: 16:9','Vertical HD: 9:16','Square: 1:1','Old: 4:3'],
          defaultId: 3,
          title: 'Which aspect ratio?',
          message: 'Which aspect ratio would you like to use?',
          detail: 'The aspect ratio defines the size of your boards. 2.35 is the widest, like what you would watch in a movie. 16x9 is what you would watch on a modern TV. 4x3 is what your grandpops watched back when screens flickered and programming was wholesome.',
        }, (response)=>{
          let newBoardObject = {
            aspectRatio: 2.333,
            fps: 24,
            defaultBoardTiming: 2000,
            boards: []
          }
          let aspects = [2.39, 2, 1.85, 1.7777777777777777, 0.5625, 1, 1.3333333333333333]
          newBoardObject.aspectRatio = aspects[response]
          fs.writeFileSync(path.join(filename, boardName + '.storyboarder'), JSON.stringify(newBoardObject))
          fs.mkdirSync(path.join(filename, 'images'))
          loadStoryboarderWindow(path.join(filename, boardName + '.storyboarder'))
        })
      } else {
        console.log("error: already exists")
      }
    }
  })
}

let loadStoryboarderWindow = (filename, scriptData, locations, characters, boardSettings, currentPath) => {
  if (welcomeWindow) {
    welcomeWindow.hide()
  }
  if (newWindow) {
    newWindow.hide()
  }

  const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    acceptFirstMouse: true,
    backgroundColor: '#333333',

    width: Math.min(width, 2480),
    height: Math.min(height, 1350),

    minWidth: 1024,
    minHeight: 640,
    show: false,
    resizable: true,
    titleBarStyle: 'hidden-inset',
    webPreferences: {
      webgl: true,
      experimentalFeatures: true,
      experimentalCanvasFeatures: true,
      devTools: true
    } 
  })

  // http://stackoverflow.com/a/39305399
  const onErrorInWindow = (event, error, url, line) => {
    if (mainWindow) {
      mainWindow.show()
      mainWindow.webContents.openDevTools()
    }
    console.error(error, url, line)
  }

  if (isDev) ipcMain.on('errorInWindow', onErrorInWindow)
  mainWindow.loadURL(`file://${__dirname}/../main-window.html`)
  mainWindow.once('ready-to-show', () => {
    mainWindow.webContents.send('load', [filename, scriptData, locations, characters, boardSettings, currentPath])
  })

  if (isDev) {
    mainWindow.webContents.on('devtools-focused', event => { mainWindow.webContents.send('devtools-focused') })
    mainWindow.webContents.on('devtools-closed', event => { mainWindow.webContents.send('devtools-closed') })
  }

  mainWindow.once('close', () => {
    if (welcomeWindow) {
      if (isDev) ipcMain.removeListener('errorInWindow', onErrorInWindow)
      welcomeWindow.webContents.send('updateRecentDocuments')
      welcomeWindow.show()
    }
  })
}

let addToRecentDocs = (filename, metadata) => {
  if (!prefs.recentDocuments) {
    prefs.recentDocuments = []
  }

  let currPos = 0

  for (var document of prefs.recentDocuments) {
    if (document.filename == filename) {
      prefs.recentDocuments.splice(currPos, 1)
      break
    }
    currPos++
  }

  let recentDocument = metadata

  if (!recentDocument.title) {
    let title = filename.split(path.sep)
    title = title[title.length-1]
    title = title.split('.')
    title.splice(-1,1)
    title = title.join('.')
    recentDocument.title = title
  }

  recentDocument.filename = filename
  recentDocument.time = Date.now()
  prefs.recentDocuments.unshift(recentDocument)
  // save
  prefModule.savePrefs(prefs)
  global.sharedObj.prefs = prefs
}

////////////////////////////////////////////////////////////
// ipc passthrough
////////////////////////////////////////////////////////////

//////////////////
// Main Window
//////////////////

ipcMain.on('newBoard', (e, arg)=> {
  mainWindow.webContents.send('newBoard', arg)
})

ipcMain.on('deleteBoards', (e, arg)=> {
  mainWindow.webContents.send('deleteBoards', arg)
})

ipcMain.on('duplicateBoard', (e, arg)=> {
  mainWindow.webContents.send('duplicateBoard')
})

ipcMain.on('reorderBoardsLeft', (e, arg)=> {
  mainWindow.webContents.send('reorderBoardsLeft')
})

ipcMain.on('reorderBoardsRight', (e, arg)=> {
  mainWindow.webContents.send('reorderBoardsRight')
})

ipcMain.on('togglePlayback', (e, arg)=> {
  mainWindow.webContents.send('togglePlayback')
})

ipcMain.on('goPreviousBoard', (e, arg)=> {
  mainWindow.webContents.send('goPreviousBoard')
})

ipcMain.on('goNextBoard', (e, arg)=> {
  mainWindow.webContents.send('goNextBoard')
})

ipcMain.on('previousScene', (e, arg)=> {
  mainWindow.webContents.send('previousScene')
})

ipcMain.on('nextScene', (e, arg)=> {
  mainWindow.webContents.send('nextScene')
})

ipcMain.on('copy', (e, arg)=> {
  mainWindow.webContents.send('copy')
})

ipcMain.on('paste', (e, arg)=> {
  mainWindow.webContents.send('paste')
})

/// TOOLS

ipcMain.on('undo', (e, arg)=> {
  mainWindow.webContents.send('undo')
})

ipcMain.on('redo', (e, arg)=> {
  mainWindow.webContents.send('redo')
})

ipcMain.on('setTool', (e, arg)=> {
  mainWindow.webContents.send('setTool', arg)
})

ipcMain.on('useColor', (e, arg)=> {
  mainWindow.webContents.send('useColor', arg)
})

ipcMain.on('clear', (e, arg)=> {
  mainWindow.webContents.send('clear')
})

ipcMain.on('brushSize', (e, arg)=> {
  mainWindow.webContents.send('brushSize', arg)
})

ipcMain.on('flipBoard', (e, arg)=> {
  mainWindow.webContents.send('flipBoard', arg)
})

/// VIEW

ipcMain.on('cycleViewMode', (e, arg)=> {
  mainWindow.webContents.send('cycleViewMode', arg)
})

ipcMain.on('toggleCaptions', (e, arg)=> {
  mainWindow.webContents.send('toggleCaptions', arg)
})

//////////////////
// Welcome Window
//////////////////


ipcMain.on('openFile', (e, arg)=> {
  openFile(arg)
})

ipcMain.on('openDialogue', (e, arg)=> {
  openDialogue()
})

ipcMain.on('createNew', (e, arg)=> {
  createNew()
})

ipcMain.on('openNewWindow', (e, arg)=> {
  openNewWindow()
})

ipcMain.on('preventSleep', ()=> {
  powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
})

ipcMain.on('resumeSleep', ()=> {
  powerSaveBlocker.stop(powerSaveId)
})

/// menu pass through

ipcMain.on('goBeginning', (event, arg)=> {
  mainWindow.webContents.send('goBeginning')
})

ipcMain.on('goPreviousScene', (event, arg)=> {
  mainWindow.webContents.send('goPreviousScene')
})

ipcMain.on('goPrevious', (event, arg)=> {
  mainWindow.webContents.send('goPrevious')
})

ipcMain.on('goNext', (event, arg)=> {
  mainWindow.webContents.send('goNext')
})

ipcMain.on('goNextScene', (event, arg)=> {
  mainWindow.webContents.send('goNextScene')
})

ipcMain.on('toggleSpeaking', (event, arg)=> {
  mainWindow.webContents.send('toggleSpeaking')
})

ipcMain.on('playsfx', (event, arg)=> {
  if (welcomeWindow) {
    welcomeWindow.webContents.send('playsfx', arg)
  }
})

ipcMain.on('test', (event, arg)=> {
  console.log('test', arg)
})

ipcMain.on('textInputMode', (event, arg)=> {
  mainWindow.webContents.send('textInputMode', arg)
})