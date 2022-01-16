import './App.css';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';

import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';
import DoneIcon from '@mui/icons-material/Done';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { red, blue } from '@mui/material/colors';

import InfoBox from './components/infobox.js';

import { useState, useEffect, useRef } from "react";

import all_paths from './common_paths.json';
import words from './wordlist.json';


const startDate = new Date("2022/01/14");
const dayLength = 1000 * 60 * 60 * 24;


const theme = createTheme({
  palette: {
    primary: {
      main: red[500],
    },
    secondary: {
      main: blue[500],
    },
  },
});


const styles = {

  'goal': {
    'container':
        "rounded-xl relative z-10 overflow-hidden " +
        "border border-primary border-opacity-20 shadow-pricing " +
        "my-10 mx-auto w-fit px-5 py-5 sm:px-20",
    'text': 'sm:text-3xl text-2xl font-semibold'
  },
  'guesses':{
    'container': "mb-5",
    'text': 'text-2xl',
    'addtext': 'text-2xl text-blue',
    'removetext': 'text-2xl text-red ml-5 absolute'
  },
  'input':{
    'container': 'mt-11'
  }
}

const getDifference = (s, t) => {
  s = [...s].sort();
  t = [...t].sort();
  return t.find((char, i) => char !== s[i]);
};

function App() {
  const [pathlen, setPathlen] = useState(3);
  const [paths, setPaths] = useState(all_paths);
  const [path, setPath] = useState(['', '']);
  const [guesses, setGuesses] = useState([]);
  const [added, setAdded] = useState('');
  const [removed, setRemoved] = useState('');
  const [addString, setAddString] = useState('');
  const [removeString, setRemoveString] = useState('');
  const [removeCursor, setRemoveCursor] = useState(undefined);
  const [addCursor, setAddCursor] = useState(undefined);

  const removeRef = useRef();
  const addRef = useRef();

  const filterPaths = (len) => {
    setPaths(() => {
      return all_paths.filter(path => path.length===len);
    })
  }

  const choosePath = (method="date") => {
    let source
    let target
    if (method === "date") {
      let today = new Date();
      let ndays = Math.round((today.getTime() - startDate.getTime())/dayLength);
      // console.log('ndays', ndays);
      source = paths[ndays]['source'];
      target = paths[ndays]['target']
    } else if (method === "random"){
      let pathidx = Math.floor(Math.random()*paths.length)
      source = paths[pathidx]['source'];
      target = paths[pathidx]['target']
    }
    setPath([source, target]);
    setAddString(source)
    setRemoveString(source)
    setGuesses([{full:source, first:source, added:'', last:'',removed:''}])
  }

  const updateLength = useEffect(() => {
    filterPaths(pathlen)
  }, [pathlen])

  const handlePathlenChange = (event) => {
    setPathlen(event.target.value);
  }

  const resetPath = useEffect(() => {
    choosePath('date')
  }, [paths])

  const handleAdd = (event) => {
    let cursorPos = addRef.current.selectionStart;
    if (event.nativeEvent.inputType === "deleteContentBackward"){
      if (added.length > 0 && cursorPos === addCursor - 1){
        setAdded(added.slice(0,added.length-1));
        setAddCursor(cursorPos)
        setAddString(event.target.value)
      }
    } else {
      // console.log('adding', {addCursor, cursorPos})
      if (addCursor === 0 || addCursor === undefined || cursorPos === addCursor+1) {
          setAdded(added + event.nativeEvent.data);
          setAddCursor(cursorPos)
          setAddString(event.target.value)
      }
    }
  }

  const addFromRemoved = useEffect(() => {
  //  build the addString from the removedString, addCursor, and added
  //  (because you remove text from the base string, then have
  //  potentially added text in the add string!
    if (added.length === 0){
      setAddString(removeString)
    } else {
      let newAddString = removeString.slice(0,removeCursor) + added + removeString.slice(removeCursor, removeString.length)
      setAddString(newAddString)
      setAddCursor(removeCursor + added.length)
    }

  }, [removeString]);

   const textPieces = () => {
     let first;
     let textadded;
     let last;
     if (added.length === 0){
       first = addString
       textadded = ''
       last = ''
     } else {
       first = addString.slice(0,addCursor-added.length);
       textadded = added;
       last = addString.slice(addCursor, addString.length)
     }

     return ({full:addString, first, added:textadded, last, removed})
   }

  const handleRemove = (event) => {
    if (event.nativeEvent.inputType !== "deleteContentBackward"){
      event.preventDefault()
    } else {

      let cursorPos = removeRef.current.selectionStart;
      // console.log('backspace! position', cursorPos);
      if (removeCursor === 0 || removeCursor === undefined || cursorPos === removeCursor - 1) {
        setRemoveCursor(cursorPos)
        setRemoved(getDifference(event.target.value,removeString) + removed)
        setRemoveString(event.target.value)

      }
    }
  }

  const resetGuess = (event) => {
    setAdded('')
    setRemoved('')
    if (guesses.length >0) {
      setAddString(guesses[guesses.length - 1]['full'])
      setRemoveString(guesses[guesses.length - 1]['full'])
    }
    setRemoveCursor(undefined)
    setAddCursor(undefined)

  }

  const confirmGuess = (event) => {
    // console.log('confirmevent', event)

    // if (
    //     (words.includes(added) || added === '') &&
    //     (words.includes(removed) || removed === '') &&
    //     (words.includes(addString))
    // ){
      let newg = guesses;
      let guessPieces = textPieces();
      //  set removed text in the previous guess
      newg[newg.length-1]['removed'] = guessPieces['removed']
      guessPieces['removed'] = ''
      //  push new piece
      newg.push(guessPieces);
      setGuesses(newg);
      resetGuess();
      // console.log(newg)
    // } else {
    //   resetGuess()
    // }

  }


  return (
      <ThemeProvider theme={theme}>
    <div className="App">
      <AppBar
          position="static"
          sx={{
            'color': '#000',
        'backgroundColor': "#fafafa",
            'borderBottom': "1px solid #ff0000"
      }}>
        <Toolbar className={"flex"}>
          <h1 className={"flex-auto w-32 text-left font-extrabold font-xl"}>
            ReCurse
          </h1>
          <InfoBox>
          </InfoBox>
          <IconButton
              aria-label={'refresh'}
              onClick={() => {choosePath('random')}}
              className={'flex-initial w-8'}
          >
            <RefreshIcon/>
          </IconButton>
          <FormControl
              variant="standard"
              className={"flex-auto w-16"}
          >
            <InputLabel sx={{"color":"#ff0000"}}>
              Shortest Path</InputLabel>

            <Select
              value={pathlen}
              label="Shortest Path"
              onChange={handlePathlenChange}
          >
            {[...Array(7).keys()].map((val) => (
                <MenuItem className={'text-white'} key={val+1} id={val+1} value={val+1}>{val+1}</MenuItem>
            ))}
          </Select>
          </FormControl>
        </Toolbar>
      </AppBar>

      <div id={"game"} className={"flex-col content-center max-w-prose mx-auto"}>
        <div id={"path-goal"} className={styles['goal']['container']}>
          <span id={"path-source"} className={styles['goal']['text']}>
            {path[0] + " "}
          </span>
          <span id={"path-arrow"} className={styles['goal']['text']}>
            ☞
          </span>
          <span id={"path-target"} className={styles['goal']['text']}>
            {" " + path[1]}
          </span>
        </div>

        <div id={"guesses"}>
          {guesses.map(aguess => (
            <div key={'guess-'+aguess['full']} className={styles['guesses']['container']}>
              <span className={styles['guesses']['text']}>
                {aguess['first']}
              </span>
              <span className={styles['guesses']['addtext']}>
                {aguess['added']}
              </span>
              <span className={styles['guesses']['text']}>
                {aguess['last']}
              </span>
              {aguess['removed'].length >0 ?
                <span className={styles['guesses']['removetext']}>
                -{aguess['removed']}
                </span>
                :<span></span>}
            </div>
          ))}
        </div>

        <div id={'input'} className={styles['input']['container']}>
          <div id={'inputTextBoxes'} className={"flex flex-row"}>

          <TextField
              inputRef={removeRef}
              label="Remove a Word"
              value={removeString}
              onChange={handleRemove}
              className={'flex-auto w-64'}
          ></TextField>
          <TextField
              inputRef={addRef}
              label="Add a Word"
              color={"secondary"}
              value={addString}
              onChange={handleAdd}
              className={'flex-auto w-64'}
          ></TextField>
          </div>

          <div id={'instatus'} className={'flex flex-row'}>
            <IconButton
                aria-label={'refresh'}
                onClick={resetGuess}
                className={'flex-auto w-16'}
            >
              <RefreshIcon/>
            </IconButton>
            <span className={'text-red flex-auto w-16'}>
              -{removed}
            </span>
            <span className={'flex-auto w-64'}></span>
            <span className={'text-blue flex-auto w-16'}>
            +{added}
            </span>
            <IconButton
                aria-label={'refresh'}
                onClick={confirmGuess}
                className={'flex-auto w-16'}
            >
              <DoneIcon/>
            </IconButton>
          </div>
        </div>

      </div>

    </div>
      </ThemeProvider>
  );
}

export default App;
