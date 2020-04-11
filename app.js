var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var glob = require("glob")
var router = express.Router();

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//express server
const server = require('http').Server(app);
const io = require('socket.io')(server);
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
  console.log('Press Ctrl+C to quit.');
});
io.sockets.emit('refresh');

app.use('/', router);
router.get('/', function (req, res, next) {
  res.render('index', {});
});



//create deck
var deck = []; //['🂡', '🂢', '🂣', '🂤', '🂥', '🂦', '🂧', '🂨', '🂩', '🂪', '🂫', '🂭', '🂮', '🂱', '🂲', '🂳', '🂴', '🂵', '🂶', '🂷', '🂸', '🂹', '🂺', '🂻', '🂽', '🂾', '🃁', '🃂', '🃃', '🃄', '🃅', '🃆', '🃇', '🃈', '🃉', '🃊', '🃋', '🃍', '🃎', '🃑', '🃒', '🃓', '🃔', '🃕', '🃖', '🃗', '🃘', '🃙', '🃚', '🃛', '🃝', '🃞', '🂿', '🃟'];
glob("./public/cards/*", function (er, files) {
  deck = files;
  deck.forEach((card, index, array) => array[index] = card.replace(`/public`, ``));
  //console.log(deck);
})

//globals for tracking state
var players = [];
var playerdata = [];
var tempplayers = [];
var tempplayerdata = [];
var discard = [];
var pile = [];
var turn = 0;
var dontWaitUp = null;
var dontWaitUpCard = '';
var reverseDirection = false;
var dealer = 0;
var inProgress = false;
var challengeEnabled = false;
var drawEnabled = false;
var drawAmount = 0;
var slapdownCounter = 0;
var wildColour = ' ';
var currentColour = ' ';
var prevCurrentColour = ' ';
var lowestValue = 1000;
var highestValue = 0;
var winner = '';
var loser = '';
var resetEnabled;
var skippedPlayer;
var skip;
var reverseCard;
var slapdownCard;
var turnCounter;
var playedCard = '';
var killmessage = '';
var endmessage = '';
var lockPlayers = false;
var unlucky;

//open a socket
io.on('connection', function (socket) {
  console.log(`a user connected - ${socket.id}`);

  //log message on disconnect
  socket.on('disconnect', function () {
    console.log(`user disconnected`);
  });

  //user connected and sends uuid to identify
  socket.on('register', function (uuid) {
    console.log('register: ' + uuid);
    //does player exist?
    if (players.find(player => player.uuid == uuid) != null) {
      //player exists
      console.log(`player ${uuid} exists`);
      players.find((player, playerIndex) => {
        players[playerIndex].socket = socket.id;
      });
    } else {
		if(!lockPlayers) {
		  //create new player
		  console.log(`player ${uuid} created`);
		  players.push({ uuid, hand: [], socket: socket.id, name: `Player ${players.length + 1}` });
		  let newplayerindex = uuidToIndex(uuid);
		  playerdata.push({ cardsInHand: 0, score: 0, lastRound: 0, wins: 0, name: players[newplayerindex].name, uno: false, blink: false, unotime: null, status: '' });
		  if (inProgress) {
			message(`new player ${uuidToName(uuid)} - joined halfway through a game`);
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
			players[newplayerindex].hand.push(pile.pop());
			checkPile();
		  }
      }
    }
    updateState();
  });

  //sort your hand
  socket.on('sort', function (uuid) {
    let playerIndex = null;
    playerIndex = uuidToIndex(uuid);
    console.log(`${uuidToName(uuid)} sorted their hand`);
    players[playerIndex].hand.sort();
    updateState()
  });

  //user start a new game
  socket.on('deal', function (uuid) {
    if (players[dealer].uuid == uuid) {
      message(`${uuidToName(uuid)} - dealt`);
      clearHands();
      deal();
      updateState()
    }
    else {
      message(`${uuidToName(uuid)} dealt out of turn`);
    }
  });

  //uno and catch
  socket.on('uno', function (uuid) {
    let playerIndex = null;
    playerIndex = uuidToIndex(uuid);
    if (players[playerIndex].hand.length == 1) {
      message(`${uuidToName(uuid)} - said Uno!`);
      playerdata[playerIndex].uno = true;
      updateState();
    }
  });
  socket.on('catch', function (data) {
    console.log(data);
    let playerIndex = data.i;
    let uuid = data.uuid;
    message(`${uuidToName(uuid)} - tried to catch ${playerdata[playerIndex].name}`);
    if (playerdata[playerIndex].unotime == null) {
      message(`${playerdata[playerIndex].name} was not in Uno`);

    } else {
      if (playerdata[playerIndex].uno) {
        message(`${playerdata[playerIndex].name} had already said Uno!`);
      } else {
        var catchtime = turnCounter;
        var turnsSince = (catchtime - playerdata[playerIndex].unotime);
        if (turnsSince < 1) {
          message(`${playerdata[playerIndex].name} went into Uno ${turnsSince} turns ago, they have 1 turn to say Uno!`);

        } else {
          message(`${playerdata[playerIndex].name} has not said Uno, and it's been ${turnsSince} turns since they went into Uno - CAUGHT! `);
          playerdata[playerIndex].uno = false;
          playerdata[playerIndex].unotime = null;
          for (let drawIndex = 0; drawIndex < 2; drawIndex++) {
            players[playerIndex].hand.push(pile.pop());
            checkPile();
          }
          playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
        }

      }

    }

    updateState();

  });
  
  socket.on('kill', function (data) {
    console.log(data);
    let playerIndex = data.i;
    let uuid = data.uuid;
    message(`${uuidToName(uuid)} - killed ${playerdata[playerIndex].name}`);
	killmessage = uuidToName(uuid) + '- killed ' + playerdata[playerIndex].name;
	
	//Update players
	
    for (let thisPlayer = 0; thisPlayer < playerIndex; thisPlayer++) {
		tempplayers[thisPlayer] = players[thisPlayer];
		tempplayerdata[thisPlayer] = playerdata[thisPlayer];
	}
		
    for (let thisPlayer = playerIndex + 1; thisPlayer < players.length; thisPlayer++) {
		tempplayers[thisPlayer - 1] = players[thisPlayer];
		tempplayerdata[thisPlayer - 1] = playerdata[thisPlayer];
	}
	
	players = tempplayers;
	playerdata = tempplayerdata;

	tempplayers = [];
	tempplayerdata = [];
	
	if(playerIndex == turn)
	{
		turn = nextPlayer(turn);
	}
	
	if(playerIndex == dealer)
	{
		dealer = nextPlayer(dealer);		
	}
	
    updateState();

  });

  //user picks up a card
  socket.on('pickupanddraw', function (uuid) {
    message(`${uuidToName(uuid)} picked up from the deck`);
    if (drawEnabled) {
      message(`${uuidToName(uuid)} - had to pick up ${drawAmount} cards`);
      playerIndex = uuidToIndex(uuid);
      turn = playerIndex;
      for (let drawIndex = 0; drawIndex < drawAmount; drawIndex++) {
        players[playerIndex].hand.push(pile.pop());
        checkPile();
      }
      drawAmount = 0;
      drawEnabled = false;
      challengeEnabled = false;
      reverseCard = false;
	  slapdownCard = false;
      skip = false;
      turnCounter++;
      playerdata[turn].uno = false;
      playerdata[turn].unotime = null;
      dontWaitUp = null;
      dontWaitUpCard = '';
	  killmessage = '';
	  endmessage = '';
      nextTurn(false);
      playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
      updateState();
    } else {
      message(`${uuidToName(uuid)} picked up a card`);
      if (players[turn].uuid == uuid) {
        let pickupCard = pile.pop();
        players[turn].hand.push(pickupCard);
        //check if the player can put it down straight away
        dontWaitUp = uuid;
        dontWaitUpCard = pickupCard;
        challengeEnabled = false; // Turn off challenge of wild if someone picks up.
        playerdata[turn].uno = false;
        playerdata[turn].unotime = null;
        reverseCard = false;
	    slapdownCard = false;
		killmessage = '';
		endmessage = '';
        skip = false;
        turnCounter++;
        checkPile();
        nextTurn(false);
      }
      else {
        message(`${uuidToName(uuid)} played out of turn`);
      }
      updateState();
    }
  });


  //user picks up a card - This is the original single button command
  socket.on('pickup', function (uuid) {
    message(`${uuidToName(uuid)} picked up a card`);
    if (players[turn].uuid == uuid) {
      let pickupCard = pile.pop();
      players[turn].hand.push(pickupCard);
      //check if the player can put it down straight away
      dontWaitUp = uuid;
      dontWaitUpCard = pickupCard;
      challengeEnabled = false; // Turn off challenge of wild if someone picks up.
      playerdata[turn].uno = false;
      playerdata[turn].unotime = null;
      checkPile();
      nextTurn();
    }
    else {
      message(`${uuidToName(uuid)} played out of turn`);
    }
    updateState();
  });

  //user plays a card
  socket.on('playcard', function (data) {
    let uuid = data.uuid;
    let card = data.card;
		
    
    if (card == 'challenge' || card == 'deal') {
	  wildColour = data.wildColour;
      message(`${uuidToName(uuid)} - Wild colour has been set to ${wildColour}`)
      //is this called?
      currentColour = wildColour;
	  if(unlucky){
		  nextTurn();
		  unlucky = false;
	  }	  
      updateState();
    } else {

      if (clickPolice(uuid)) {
        message(`${uuidToName(uuid)} - has been clicking too rapidly and has been temporarily throttled`);
        return;
      }
	  if (card.includes('wild')) {
        message(`${uuidToName(uuid)} - played a wild and is choosing a colour`);
		
		playedCard = card;
		playCard(card, uuid, null, socket);	
		  
	  } else if ((card.includes('colourchoice')) && (playedCard != '')) {
        message(`${uuidToName(uuid)} - chose a colour`);
		wildColour = data.wildColour;
		
		challengeEnabled = true;
		message(`${uuidToName(uuid)} - wild colour choice was ${wildColour}`);
		prevCurrentColour = currentColour;
		currentColour = wildColour;
		
		  //draw four
		  if (playedCard.includes('wild_pick')) {
			drawAmount = 4;
			drawEnabled = true;
		  }
				
		playedCard = '';
		nextTurn();
		updateState();
		  
	  } else {
		playCard(card, uuid, wildColour, null);		  
	  }
    }

  });

  //user plays challenge
  socket.on('challenge', function (uuid) {
    previousPlayerIndex = nextPlayer(turn, !reverseDirection);
    message(`${uuidToName(uuid)} challenged ${players[previousPlayerIndex].name}`);

    let invalid = false;
    //check if that colour could have been played
    players[previousPlayerIndex].hand.forEach(card => {
      invalid = invalid || card.includes(prevCurrentColour);
    });

    if (invalid) {
      //play was invalid
      message(`challenge succeeded`);
      players[previousPlayerIndex].hand.push(pile.pop());
      checkPile();
      players[previousPlayerIndex].hand.push(pile.pop());
      checkPile();
      if (discard.slice(-1).pop().includes('wild_pick')) {
        players[previousPlayerIndex].hand.push(pile.pop());
        checkPile();
        players[previousPlayerIndex].hand.push(pile.pop());
        checkPile();
        playerdata[previousPlayerIndex].uno = false;
        playerdata[previousPlayerIndex].unotime = null;
      }

      //this player now chooses the colour
      socket.emit('rechooseColour');

    } else {
      message(`challenge failed`);
      players[turn].hand.push(pile.pop());
      checkPile();
      players[turn].hand.push(pile.pop());
      checkPile();
      if (discard.slice(-1).pop().includes('picker')) {
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        playerdata[turn].uno = false;
        playerdata[turn].unotime = null;
      }
      else if (discard.slice(-1).pop().includes('wild_pick')) {
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        players[turn].hand.push(pile.pop());
        checkPile();
        playerdata[turn].uno = false;
        playerdata[turn].unotime = null;
      }

    }
    challengeEnabled = false;
    drawAmount = 0;
    drawEnabled = false;
    dontWaitUp = null;
    dontWaitUpCard = '';
    playerdata[turn].cardsInHand = players[turn].hand.length;
    playerdata[previousPlayerIndex].cardsInHand = players[previousPlayerIndex].hand.length;
    if ((!invalid) && (discard.slice(-1).pop().includes('wild_pick'))) {
      //The challenge failed, this person needs to pick up more but they don't get a turn if it's a Draw 4.
      nextTurn(false);
    }
    updateState();
  });

  //user plays pick two - This is the original single button command
  socket.on('drawCard', function (uuid) {
    message(`${uuidToName(uuid)} - had to pick up ${drawAmount} cards`);
    playerIndex = uuidToIndex(uuid);
    turn = playerIndex;
    for (let drawIndex = 0; drawIndex < drawAmount; drawIndex++) {
      players[playerIndex].hand.push(pile.pop());
      checkPile();
    }
    drawAmount = 0;
    drawEnabled = false;
    challengeEnabled = false;
    dontWaitUp = null;
    dontWaitUpCard = '';
    nextTurn(false);
    playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
    updateState();
  });

  //user changes name
  socket.on('namechange', function (data) {
    let uuid = data.uuid;
    let name = data.name;

    let invalid = false;

    name = name.replace(/[\W_]+/g, "");

    players.forEach(player => {
      if (player.name == name) {
        invalid = true;
      }
    })

    if (name.length < 2 || name.length > 20) {
      message(`${uuidToName(uuid)} tried to change their name and it was too short or too long - ${name}`);
    }
    else if (invalid) {
      message(`${uuidToName(uuid)} tried to change their name to the same name as another player - ${name}`);
    } else {
      message(`${uuidToName(uuid)} changed name to - ${name}`);
      players[uuidToIndex(uuid)].name = name;
      playerdata[uuidToIndex(uuid)].name = name;
    }
    updateState();

  });

  //reset the game
  socket.on('reset', function (uuid) {

    message(`${uuidToName(uuid)} reset the game`);
    io.sockets.emit('refresh');
    //init all of the gobals to their default state
    reset();
    return '';
  });
  
  //lock players
  socket.on('lockplayers', function (uuid) {

	lockPlayers = !lockPlayers;
	
    message(`${uuidToName(uuid)} - Player lock is now set to ${lockPlayers}`);
    updateState();
  });
});





// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

//deal the cards
function deal() {

  message(` `);
  message(`Good Luck! Have Fun!`);
  message(` `);
  message(`The player with the lowest score at this time is the winner!`);
  message(`When a player reaches 500, the game is over.`);
  message(`Wild and Draw 4 are worth 50 points`);
  message(`Skip, Reverse and Draw 2 are worth 20 points`);
  message(`Cards 0-9 are worth face value`);
  message(`The Score for each round and your cumulative score are shown`);
  message(` `);
  message(`A player can win the round without saying Uno!`);
  message(`A player who has zero cards left in their hand wins the round`);
  message(`If someone catches you after the next turn has been taken, you will receive + 2 cards`);
  message(`After the next turn has been taken, you can be caught`);
  message(`Failure to say Uno before the next turn is taken will leave you vulnerable`);
  message(`When you have one card left you must say Uno!`);
  message(`-----------`);
  message(`End Game`);
  message(` `);
  message(`but be quick, the next player doesn't have to wait for you!`);
  message(`If you pick up and you can play your new card, that card may be played,`);
  message(`If the player before you picks up, you don't need to wait to see if they can play.`);
  message(`----------------`);
  message(`Don't Wait Up!`);
  message(` `);
  message(`You cannot slapdown a Wild/Draw 4`);
  message(`Play continues on from the player that played the slapdown`);
  message(`If you have the exact same card as the top card on the discard pile, play it at any time`);
  message(`------------`);
  message(`Slapdowns`);
  message(` `);
  message(`Draw 4's do not stack`);
  message(`You cannot play a Wild/Draw 4 on a Draw 2`);
  message(`Draw 2's Stack and cannot be Skipped/Reversed`);
  message(`A failed challenge will result in the challenger picking up two additional cards`);
  message(`and the challenger choosing the colour.`);
  message(`A successful challenge will result in the original player picking up cards,`);
  message(`challenge your Wild/Draw 4`);
  message(`If the next player suspects that you had the previous colour they can`);
  message(`that you can't! `);
  message(`it is against the rules to play a Wild/Draw 4, but that doesn't mean`);
  message(`If you have the same colour card as the card on the dischard pile,`);
  message(`Play a Wild/Draw 4`);
  message(`Play the same number/symbol card as the card on the discard pile, or`);
  message(`Play the same colour card as the card on the discard pile, or`);
  message(`------`);
  message(`Rules`);
  message(` `);

  //clear the discard pile
  discard = [];
  //get the deck from the pile
  pile = [...deck]
  //randomly sort
  pile.sort(() => Math.random() - 0.5);
  //deal
  
  turn = dealer;
  players.forEach((player, playerIndex) => {
    for (let cardIndex = 0; cardIndex < 7; cardIndex++) {
      players[playerIndex].hand.push(pile.pop());
    }
    players[playerIndex].hand.sort();
    playerdata[playerIndex].cardsInHand = players[playerIndex].hand.length;
  });
  //one for the top of the discard

  discard.push(pile.pop());
  let topCard = discard.slice(-1).pop()
  if (!topCard.includes('wild')) {
    currentColour = cardColour(topCard);
  } else {
    // Choose colour
  }

  //draw two
  if (topCard.includes('picker')) {
    drawAmount = drawAmount + 2;
    drawEnabled = true;
  }

  //draw four
  if (topCard.includes('wild_pick')) {
	let unluckyplayer = nextPlayer(turn, reverseDirection);
	unlucky = true;
    message(`${playerdata[unluckyplayer].name} got dealt a Draw 4! Unlucky! They'll choose the colour.`);
	for (let cardIndex = 0; cardIndex < 4; cardIndex++) {
		  players[unluckyplayer].hand.push(pile.pop());
		}
		players[unluckyplayer].hand.sort();
		playerdata[unluckyplayer].cardsInHand = players[unluckyplayer].hand.length;
	 }

  //skip
  skip = false;
  if (topCard.includes('skip')) {
    skip = true;
    skippedPlayer = nextPlayer(turn, reverseDirection);
    message(`${playerdata[skippedPlayer].name} got skipped (1st Card)`);
  }

  //reverse
  reverseCard = false;
  endmessage = '';
  //reset direction
  reverseDirection = false;
  if (topCard.includes('reverse')) {
    reverseDirection = !reverseDirection;
    reverseCard = true;
  }
  
 for (let thisPlayer = 0; thisPlayer < players.length; thisPlayer++) {
	  playerdata[thisPlayer].blink = false;
  }
  
  nextTurn(skip);

  inProgress = true;
  turnCounter = 0;
  dealer = nextPlayer(dealer);


}

//send state to all players
function updateAllPlayers() {
  players.forEach(player => {
    //emit each hand to the specific player
    io.sockets.emit(player.uuid, player);
  });
}

//update everything to each player
function updateState() {
  //update player data
  playerdata.forEach((player, playerindex) => {
    //update cards in hand
    playerdata[playerindex].cardsInHand = players[playerindex].hand.length;
    //is turn
    playerdata[playerindex].isTurn = (playerindex == turn) && inProgress;
    //is uno
    playerdata[playerindex].isUno = playerdata[playerindex].uno;
    //is skipped

    playerdata[playerindex].isSkipped = playerdata[playerindex].skipped;
    //won
    playerdata[playerindex].isWinner = players[playerindex].hand.length == 0 && !inProgress && playerdata[playerindex].wins > 0;
    //cansort
    players[playerindex].isSortable = !(JSON.stringify(players[playerindex].hand) == JSON.stringify([...players[playerindex].hand].sort()));

	
	if (endmessage != ''){
		playerdata[playerindex].status = endmessage;				
	} 
	else if (inProgress) {
		if (playerindex == turn) {
			if (killmessage != ''){
				  playerdata[playerindex].status = killmessage + '. Your turn!';				
			} 
		  	else if (drawEnabled) {
			    if (challengeEnabled) {
			  	  playerdata[playerindex].status = 'Pick Up ' + drawAmount + ' cards, or challenge!';
			    } else {
				  if (slapdownCard) {
				    playerdata[playerindex].status = 'Slapdown! Pick up ' + drawAmount + ' cards!';

				  } else {
				    playerdata[playerindex].status = 'Pick up ' + drawAmount + ' cards!';
				  }
			    }
			}
			else if (reverseCard) {
			  if (slapdownCard) {
				playerdata[playerindex].status = 'Slapdown! Reverse! Your Turn!';
			  } else {
				playerdata[playerindex].status = 'Reverse! Your Turn!';
			  }

			}
			else {
			  if (slapdownCard) {
				playerdata[playerindex].status = 'Slapdown! Your Turn!';
			  } else {
				playerdata[playerindex].status = 'Your Turn!';
				let discardTop = discard.slice(-1).pop() || ' ';
				if (discardTop != ' ') {
				  if (discardTop.includes('wild')) {
					  if((currentColour == '') || (currentColour == ' ') || (playedCard != '')) {
						playerdata[playerindex].status = 'Your Turn! Choose a colour!'; 
					  } else {
						playerdata[playerindex].status = 'Your Turn! Colour is ' + currentColour + '!';
					  }
				  }
				}
			  }
			}
		} else {
			//Not your turn
			if (killmessage != ''){
				playerdata[playerindex].status = killmessage + '!';				
			} else if ((skip) && (playerindex == skippedPlayer)) {
				playerdata[playerindex].status = 'You got skipped!';
			} else if (reverseCard) {
				if (slapdownCard) {
					playerdata[playerindex].status = 'Slapdown! Reverse!';
				} else {
				playerdata[playerindex].status = 'Reverse!';
				}
			} else if (drawEnabled) {
				if(challengeEnabled){
					playerdata[playerindex].status = playerdata[turn].name + ' has to pick up ' + drawAmount + ' cards, or challenge!';
				} else {
					playerdata[playerindex].status = playerdata[turn].name + ' has to pick up ' + drawAmount + ' cards!';					
				}				
			}
			else {
				if (slapdownCard) {
				  playerdata[playerindex].status = 'Slapdown!';
				} else {
					playerdata[playerindex].status = '';
					let discardTop = discard.slice(-1).pop() || ' ';
					if (discardTop != ' ') {
					  if (discardTop.includes('wild')) {
						if((currentColour == '') || (currentColour == ' ') || (playedCard != '')) {
							playerdata[playerindex].status = playerdata[turn].name + ' is choosing a colour!';							
						} else {
							playerdata[playerindex].status = 'Colour is ' + currentColour + '!';
						}
					  }
					}
				}
			}
		}
    } 
    else {
		if (playerindex == dealer) {
			playerdata[playerindex].blink = true;
			playerdata[playerindex].status = 'Your Deal!';
			
		} else {
			playerdata[playerindex].status = playerdata[dealer].name + '\'s Deal!';			
		}
    }
	
	

  });

  updateAllPlayers();
  let discardTop = discard.slice(-1).pop() || ' ';
  let playerNext = players[turn].name;
  let dealerNext = players[dealer].name;
  io.sockets.emit('state', {
    discard,
    discardTop,
    discardCount: discard.length,
    pileCount: pile.length,
    playerNext,
    dealerNext,
    playerCount: players.length,
    inProgress,
    challengeEnabled,
    slapdownCount: slapdownCounter,
    drawAmount,
    drawEnabled,
    wildColour,
    reverseDirection,
    currentColour,
    playerdata,
    resetEnabled
  });
}

//send a log message to all players
function message(text) {
  console.log(text);
  io.sockets.emit('message', text);
}

//remove all cards from hands
function clearHands() {
  players.forEach((player, playerIndex) => {
    for (let i = 0; i < 7; i++) {
      players[playerIndex].hand = [];
    }
  });
}

//work out which player is next under certain conditions
function nextPlayer(playerIndex, reverse = false) {
  if (!reverse) {
    return playerIndex = (playerIndex + 1) % players.length;
  } else {
    let newindex = (playerIndex - 1);
    if (newindex < 0) newindex = players.length - 1;
    return newindex;
  }

}

//apply play card and rules
function playCard(card, uuid, wildColour = null, socket) {
  //apply rules
  //player's turn
  let playerIndex = null;
  slapdownCard = false;

  if (!inProgress) {
    message(`${uuidToName(uuid)} - tried to play after the game ended`);
    return;
  }

  if ((players[turn].uuid != uuid)) {
    message(`${uuidToName(uuid)} - played a ${cardColour(card)} ${cardNumber(card)} out of turn!`);
    if (isSlapdown(card)) {
      message(`${uuidToName(uuid)} - played a slapdown ${cardColour(card)} ${cardNumber(card)}!`);
	  slapdownCard = true;
      playerIndex = uuidToIndex(uuid);
    } else if (dontWaitUp == uuid) {
      if ((card == dontWaitUpCard) && (isPlayable(dontWaitUpCard))) {
        message(`${uuidToName(uuid)} reminded ${playerdata[turn].name} not to wait up!`);
        playerIndex = uuidToIndex(uuid);
      } else {
        if (card != dontWaitUpCard) {
          message(`${uuidToName(uuid)} - picked up a card and tried to play a different card`);
        } else {
          message(`${uuidToName(uuid)} - picked up a card and tried to play it, but it wasn't playable`);
        }
        return false;
      }
    } else {
      return false;
    }
  } else {
    playerIndex = turn;
  }

  //player must draw or challenge
  if ((challengeEnabled && drawEnabled) || unlucky) {
    message(`${uuidToName(uuid)} - tried to play a card but needs to pickup or challenge`);
    return false;
  }

  //player has card
  if (players[playerIndex].hand.indexOf(card) < 0) {
    message(`${uuidToName(uuid)} - does not have a ${cardColour(card)} ${cardNumber(card)}`);
    return false;
  }

  if (!isPlayable(card)) {
    message(`${uuidToName(uuid)} - a ${cardColour(card)} ${cardNumber(card)} cannot be played on a ${cardColour(discard.slice(-1).pop())} ${cardNumber(discard.slice(-1).pop())}`);
    return false;
  }


  turn = playerIndex;
  dontWaitUp = null;
  dontWaitUpCard = '';
  turnCounter++;
  killmessage = '';
	  
  //Modifiers

  //draw two
  if (card.includes('picker')) {
    drawAmount = drawAmount + 2;
    drawEnabled = true;
  }

  //skip
  skip = false;
  if (card.includes('skip')) {
    skip = true;
    skippedPlayer = nextPlayer(turn, reverseDirection);
    message(`${uuidToName(uuid)} skipped  ${playerdata[skippedPlayer].name}`);
  }



  //reverse
  reverseCard = false;
  if (card.includes('reverse')) {
    reverseDirection = !reverseDirection;
    reverseCard = true;
  }

  if (!card.includes('wild')) {
    currentColour = cardColour(card);
  }

  //log put down
  message(`${uuidToName(uuid)} - played a ${cardColour(card)} ${cardNumber(card)} `);
  //add card to discard
  discard.push(card);
  //remove from hand
  players[playerIndex].hand = players[playerIndex].hand.filter((item) => { return item !== card });
  
    //wild choose colour
  if ((card.includes('wild')) && (players[playerIndex].hand.length != 0)) {
	  socket.emit('newchooseColour');
  } else {
    challengeEnabled = false;
  }  

  //check for win
  if (players[playerIndex].hand.length == 0) {
	  
	if (card.includes('wild_pick')) {
		drawAmount = 4;
		drawEnabled = true;
	}
	  
    message(`${uuidToName(uuid)} won the round`);
    //if there are cards to draw, draw them for the next player
    if (drawEnabled) {
      let drawIndex = nextPlayer(turn, reverseDirection);
      for (let draws = 0; draws < drawAmount; draws++) {
        players[drawIndex].hand.push(pile.pop());
        checkPile();
      }
    }
    //cancel all interim states
    drawAmount = 0;
    drawEnabled = false;
    challengeEnabled = false;

    inProgress = false;
    updateScore();
    playerdata[playerIndex].wins += 1;
    lowestValue = 1000;
    highestValue = 0;
    winner = '';
    loser = '';
    //check game over
    for (let thisPlayer = 0; thisPlayer < players.length; thisPlayer++) {
		
	  playerdata[thisPlayer].uno = false;
	  playerdata[thisPlayer].unotime = null;
	
      if (playerdata[thisPlayer].score < lowestValue) {
        lowestValue = playerdata[thisPlayer].score;
        winner = playerdata[thisPlayer].name;
      }
      if (playerdata[thisPlayer].score > highestValue) {
        highestValue = playerdata[thisPlayer].score;
        loser = playerdata[thisPlayer].name;
      }
    }
    if (highestValue > 500) {

      message(`${winner} won the game with a score of ${lowestValue}. ${loser} had the highest score of ${highestValue}.`);
	  endmessage = winner + ' won the game with a score of ' + lowestValue + '. ' + loser + ' had the highest score of ' + highestValue + '.';
      inProgress = false;
      resetEnabled = true;
      updateState();
      return true;
    }



  }
  //Check if now in Uno
  if (players[playerIndex].hand.length == 1) {
    playerdata[playerIndex].unotime = turnCounter;
  }

  if (!card.includes('wild')) {
    nextTurn(skip);
  }
  
  updateState();
  

  
  return true;
}

//check if the card is playable
function isPlayable(card) {
  //same colour, number or is a wild
  let topCard = discard.slice(-1).pop() || ' ';
  let cardsets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'picker', 'skip', 'reverse'];
  let colours = ['yellow', 'blue', 'red', 'green'];
  let valid = false;
  if (drawEnabled) {
    valid = valid || (topCard.includes('picker') && card.includes('picker'));
  } else {
    valid = card.includes('wild') || topCard == ' ';
    colours.forEach(colour => {
      cardsets.forEach(cardset => {
        valid = valid || (topCard.includes(colour) && card.includes(colour))
          || (topCard.includes(cardset) && card.includes(cardset)) || (card.includes(currentColour));
      });
    });
  }
  return valid;
}

//check if the card is a slapdown 
function isSlapdown(card) {
  //same colour and number 
  let topCard = discard.slice(-1).pop() || ' ';
  let cardsets = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'picker', 'skip', 'reverse'];
  let colours = ['yellow', 'blue', 'red', 'green'];
  let slap = false;
  colours.forEach(colour => {
    cardsets.forEach(cardset => {
      slap = slap || ((topCard.includes(colour) && card.includes(colour))
        && (topCard.includes(cardset) && card.includes(cardset)));
    });
  });
  return slap;
}

//check to see if there are plenty of cards in the pile
function checkPile() {
  //if there are no more cards in the pile, reshuffle discard
  if (pile.length < 2) {
    //hold the top card
    let topcard = discard.pop();
    //randomly sort
    pile.sort(() => Math.random() - 0.5);
    //put them in the pile
    discard.forEach(card => pile.push(card));
    //empty discard and put the original card back on
    discard = [topcard];
  }
}

//check to see if there are plenty of cards in the pile
function updateScore() {
  var scoreInHand;
  for (let thisPlayer = 0; thisPlayer < players.length; thisPlayer++) {
    scoreInHand = 0;

    players[thisPlayer].hand.forEach(card => {
      if (card.includes('0')) scoreInHand += 0;
      if (card.includes('1')) scoreInHand += 1;
      if (card.includes('2')) scoreInHand += 2;
      if (card.includes('3')) scoreInHand += 3;
      if (card.includes('4')) scoreInHand += 4;
      if (card.includes('5')) scoreInHand += 5;
      if (card.includes('6')) scoreInHand += 6;
      if (card.includes('7')) scoreInHand += 7;
      if (card.includes('8')) scoreInHand += 8;
      if (card.includes('9')) scoreInHand += 9;
      if (card.includes('picker')) scoreInHand += 20;
      if (card.includes('reverse')) scoreInHand += 20;
      if (card.includes('skip')) scoreInHand += 20;
      if (card.includes('colora')) scoreInHand += 50;
      if (card.includes('pick_four')) scoreInHand += 50;
    });
    playerdata[thisPlayer].score = playerdata[thisPlayer].score + scoreInHand;
    playerdata[thisPlayer].lastRound = scoreInHand;
  }
}


function turnTimer(arg) {
  if(arg == turn) {
	playerdata[arg].blink = true;
  }
  updateState();
}

//apply the next turn
function nextTurn(Skip = false) {

  for (let thisPlayer = 0; thisPlayer < players.length; thisPlayer++) {
	  playerdata[thisPlayer].blink = false;
  }
  turn = nextPlayer(turn, reverseDirection);
  if (Skip) turn = nextPlayer(turn, reverseDirection);
  setTimeout(turnTimer, 5000, turn);
  io.sockets.emit('turn', turn);
}

//convert a uuid to a friendly name
function uuidToName(uuid) {
  let name = '';
  let index = 0;
  players.forEach((player, playerIndex) => {
    if (player.uuid == uuid) {
      name = player.name;
      index = playerIndex;
    }
  });
  return name;
}

//convert a uuid to player index
function uuidToIndex(uuid) {
  let index = 0;
  players.forEach((player, playerIndex) => {
    if (player.uuid == uuid) {
      name = player.name;
      index = playerIndex;
    }
  });
  return index;
}

function cardColour(card, capitalise = false) {
  if (card.includes('red')) return 'red';
  if (card.includes('blue')) return 'blue';
  if (card.includes('yellow')) return 'yellow';
  if (card.includes('green')) return 'green';
  return '';
}

function reset() {
  players = [];
  playerdata = [];
  discard = [];
  pile = [];
  turn = 0;
  dontWaitUp = null;
  dontWaitUpCard = '';
  reverseDirection = false;
  dealer = 0;
  inProgress = false;
  challengeEnabled = false;
  drawEnabled = false;
  slapdownCounter = 0;
  drawAmount = 0;
  turnCounter = 0;
  wildColour = ' ';
  currentColour = ' ';
  resetEnabled = false;
  endmessage = '';
  killmessage = '';
}

function cardNumber(card) {
  if (card.includes('0')) return 'zero';
  if (card.includes('1')) return 'one';
  if (card.includes('2')) return 'two';
  if (card.includes('3')) return 'three';
  if (card.includes('4')) return 'four';
  if (card.includes('5')) return 'five';
  if (card.includes('6')) return 'six';
  if (card.includes('7')) return 'seven';
  if (card.includes('8')) return 'eight';
  if (card.includes('9')) return 'nine';
  if (card.includes('picker')) return 'draw two';
  if (card.includes('reverse')) return 'reverse';
  if (card.includes('skip')) return 'skip';
  if (card.includes('colora')) return 'wild';
  if (card.includes('pick_four')) return 'wild draw four';
}

//count the number of clicks and restrict if too many
var clickCounter = [];
function clickPolice(uuid, timeout_ms = 5000, limit = 5) {

  if (!inProgress) {
    return false;
  }

  var time = new Date().getTime();

  //initialise array if it is not initialised
  clickCounter[uuid] = (typeof clickCounter[uuid] != 'undefined' && clickCounter[uuid] instanceof Array) ? clickCounter[uuid] : []
  //add the current time to end
  clickCounter[uuid].push(time)

  //filter to just samples within timeout
  clickCounter[uuid] = clickCounter[uuid].filter(el => { return el > (time - timeout_ms) });

  //check if samples exceeds limit
  if (clickCounter[uuid].length > limit) return true;

  return false;
}

module.exports = app;
