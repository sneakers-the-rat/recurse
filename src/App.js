import logo from './logo.svg';
import './App.css';

import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import InputLabel from '@mui/material/InputLabel';

import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import RefreshIcon from '@mui/icons-material/Refresh';

import { useState, useEffect, useRef } from "react";


import all_paths from './common_paths.json'

const startDate = new Date("2022/01/14");
const dayLength = 1000 * 60 * 60 * 24;

const styles = {

  'goal': {
    'container': "rounded-xl relative z-10 overflow-hidden border border-primary border-opacity-20 shadow-pricing my-10 mx-auto w-fit px-5 py-5 sm:px-20",
    'text': 'font-mono text-xl font-bold'
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
  const [guess, setGuess] = useState('');
  const [added, setAdded] = useState('');
  const [removed, setRemoved] = useState('');
  const [cursor, setCursor] = useState(0);
  const [cursorStart, setCursorStart] = useState(undefined);
  const [cursorOffset, setCursorOffset] = useState(0);

  const inputRef = useRef();

  const filterPaths = (len) => {
    setPaths(() => {
      return all_paths.filter(path => path.length===len);
    })
  }

  const choosePath = (method="date") => {
    if (method === "date") {
      let today = new Date();
      let ndays = Math.round((today.getTime() - startDate.getTime())/dayLength);
      console.log('ndays', ndays);
      let source = paths[ndays]['source'];
      let target = paths[ndays]['target']
      setPath([source, target]);
      setGuess(source)
    }
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

  const handleTyping = (event) => {
    console.log(event);
    console.log(inputRef.current.selectionStart)
    let cursorPos = inputRef.current.selectionStart;
    let _cursorStart = cursorStart;
    let _cursorOffset = cursorOffset
    if (cursorStart === undefined) {
      _cursorOffset = 0
      _cursorStart = cursorPos

    }

    console.log('cursorpos', cursorPos, _cursorStart, _cursorOffset)

    if (event.nativeEvent.inputType === "insertText") {
      // typed a key
      if (_cursorStart + _cursorOffset === cursorPos) {
        //  adding to the end
        setAdded(added + event.nativeEvent.data)
        console.log('added to end');

        _cursorOffset += 1
      } else if (_cursorOffset < 0){
      //  adding back after removing?
        setAdded(added + event.nativeEvent.data)
        _cursorOffset += 1
      } else {
        console.log('not implemented, adding in different position')
      }


    } else if (event.nativeEvent.inputType === "deleteContentBackward"){
    //  backspaced
      if (_cursorStart + cursorOffset === cursorPos) {
        if (added.length > 0) {
          setAdded(added.slice(0,added.length-1))
        } else {
          setRemoved(getDifference(event.target.value,guess) + removed)
        }
        _cursorOffset -= 1
      } else {
        console.log('not implemented, backspace in different position')
      }
    }

    setCursorOffset(_cursorOffset);
    setCursorStart(_cursorStart)
    setCursor(cursorPos);
    setGuess(event.target.value);
  }

  const handleCursor = (event) => {
    console.log('cursor', event)
  }

  const resetGuess = (event) => {
    setCursorStart(undefined)
    setCursorOffset(0)
    setGuess(path[0])
    setAdded('')
    setRemoved('')
  }


  return (
    <div className="App">
      <AppBar position="static">
        <Toolbar className={"flex"}>
          <div className={"flex-auto w-64 text-left"}>
            ReCurse
          </div>

          <FormControl variant="standard"  className={"flex-auto w-32"}>
            <InputLabel id="demo-simple-select-label">Shortest Path</InputLabel>

            <Select
              value={pathlen}
              label="Shortest Path"
              onChange={handlePathlenChange}
          >
            {[...Array(7).keys()].map((val) => (
                <MenuItem className={'text-white'} id={val+1} value={val+1}>{val+1}</MenuItem>
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
            ->
          </span>
          <span id={"path-target"} className={styles['goal']['text']}>
            {" " + path[1]}
          </span>
        </div>

        <div id={"guesses"}>

        </div>

        <div id={"input"} className={"flex flex-row"}>
          <TextField
            inputRef = {inputRef}
            label = "Add, Erase, or Swap a Word"
            value = {guess}
            onChange= {handleTyping}
            onSelectionChange = {handleCursor}
            className = {"flex-auto w-64"}
          ></TextField>
          <IconButton
              aria-label={"refresh"}
              onClick={resetGuess}
              className={"flex-auto w-16"}
          >
            <RefreshIcon />
          </IconButton>
        </div>
        <div id={"instatus"} className={"flex flex-row"}>
          <span className={"text-red flex-auto w-16"}>
            -{removed}
          </span>
          <span className={"flex-auto w-64"}></span>
          <span className={"text-green flex-auto w-16"}>
            +{added}
          </span>
        </div>
      </div>

    </div>
  );
}

export default App;
