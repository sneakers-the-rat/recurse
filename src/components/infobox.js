import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { useState } from 'react';

export default function InfoBox() {
  const [open, setOpen] = useState(false);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
      <div>
        <IconButton
            aria-label={'refresh'}
            onClick={handleClickOpen}
            className={'flex-initial w-8'}
        >
          <HelpOutlineIcon/>
        </IconButton>
        <Dialog
            open={open}
            onClose={handleClose}
            aria-labelledby="alert-dialog-title"
            aria-describedby="alert-dialog-description"
        >
          <DialogTitle id="alert-dialog-title">
            {"ReCurse is a Cursed Game"}
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="alert-dialog-description">
              An extension of <a href={"https://github.com/sneakers-the-rat/recurse-words"}>recurse-words</a>,
              ReCurse is probably too hard of a game to be fun.
              <br/><br/>
              The object of the game is to get from the source to the target word
              across multiple steps. On each step you may <emph>remove, add, or replace </emph>
              from the current word -- the catch is that everything you add and remove must
              <emph> also </emph> be a word.

              <br/><br/>

              You are given the minimum possible steps from the source to the target word,
              (default 3) but it may take many more than that. You <emph>cannot undo</emph> and you
              <emph>cannot repeat</emph> a word in your path.

              <br/><br/>
              Only >=3 letter words from a <a href={"https://github.com/first20hours/google-10000-english"}>
              list of 10000 common words</a> are allowed.

              <br/><br/>

              This game is <emph>not done </emph> but if you'd like to
              contribute/tweak something feel free to make a <a href={"https://github.com/sneakers-the-rat/recurse"}> pull request</a>

            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose} autoFocus>
              OK I Guess
            </Button>
          </DialogActions>
        </Dialog>
      </div>
  );
}
