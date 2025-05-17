import { WebSocketServer } from "ws";
import { httpServer } from "./src/http_server/index.js";
import { getBotShipsVariant } from "./botShips.js";
const wss = new WebSocketServer({
  port: 3000,
});

const HTTP_PORT = 8181;

console.log(`Start static http server on the ${HTTP_PORT} port!`);
httpServer.listen(HTTP_PORT);
const usersMap = new Map();
const roomsMap = new Map();
const socketsMap = new Map();
const gamesMap = new Map();

function getWinners() {
  const usersArr = Array.from(usersMap);
  const users = usersArr.map((item) => item[1]);
  return users.map((user) => ({
    name: user.name,
    wins: user.wins,
  }));
}

const SEND_EVENTS = {
  reg: sendReg,
  update_winners: updateWinners,
  create_game: createGame,
  update_room: updateRoom,
  start_game: startGame,
  turn: turn,
  finish: finish,
};

const INCOMING_EVENTS = {
  reg: reg,
  create_room: createRoom,
  add_user_to_room: addUserRoRoom,
  add_ships: addShips,
  attack: attack,
  randomAttack: randomAttack,
  single_play: singlePlay,
};

function singlePlay(data, ws) {
  const currentUser = usersMap.get(ws.playerId);
  const createdRoom = generateRoom({
    name: "BOT",
    id: "BOT",
  });
  addUserRoRoom(
    JSON.stringify({
      indexRoom: createdRoom.roomId,
    }),
    ws
  );
  roomsMap.delete(createdRoom.roomId);
  const actualGame = Array.from(gamesMap).filter(([gameId, gameInfo]) => {
    return gameInfo.roomUsers.some(
      (roomUser) =>
        roomUser.index === "BOT" || roomUser.index === currentUser.index
    );
  })[0];
  const ganeratedShips = getBotShipsVariant();
  addShips(
    JSON.stringify({
      gameId: actualGame[0],
      ships: ganeratedShips,
      indexPlayer: "BOT",
    })
  );
}

function sendReg(data, ws) {
  ws.send(
    JSON.stringify({
      type: "reg",
      data: JSON.stringify(data),
      id: 0,
    })
  );
}

function reg(body, ws) {
  const data = JSON.parse(body);
  const user = usersMap.values().find((user) => user.name === data.name);
  if (user) {
    sendError("User exists", ws);
    return;
  }
  const id = Date.now();

  usersMap.set(id, {
    id,
    ...data,
    wins: 0,
  });
  const requestData = {
    name: data.name,
    index: id,
    error: false,
    errorText: "",
  };

  SEND_EVENTS.reg(requestData, ws);
  SEND_EVENTS.update_room(ws);
  SEND_EVENTS.update_winners(ws);
  ws.playerId = id;
  socketsMap.set(id, ws);
}

function updateWinners() {
  const winners = getWinners();
  sendAllMessage(
    JSON.stringify({
      type: "update_winners",
      data: JSON.stringify(winners),
      id: 0,
    })
  );
}

function generateRoom(user, ws) {
  const roomId = String(Date.now());

  const createRoomData = {
    roomId,
    available: true,
    roomUsers: [
      {
        name: user.name,
        index: user.id,
      },
    ],
  };
  roomsMap.set(roomId, createRoomData);
  SEND_EVENTS.update_room(ws);
  return createRoomData;
}
function createRoom(data, ws) {
  const user = usersMap.get(ws.playerId);
  const createRoomData = generateRoom(user, ws);
  addUserRoRoom(
    JSON.stringify({
      indexRoom: createRoomData.id,
    }),
    ws
  );
  return createRoomData;
}

function sendError(message, ws) {
  ws.send(
    JSON.stringify({
      message,
    })
  );
}

function addUserRoRoom(data, ws) {
  const currentUser = usersMap.get(ws.playerId);
  const body = JSON.parse(data);
  const addedRoomId = body.indexRoom;
  const room = roomsMap.get(addedRoomId);
  if (!room) {
    sendError("Not found room", ws);
    return;
  }
  if (room.roomUsers.some((user) => user.index === currentUser.id)) {
    ws.send(
      JSON.stringify({
        message: "User with this id already in room",
      })
    );
    return;
  }

  room.roomUsers.push({
    name: currentUser.name,
    index: currentUser.id,
  });
  room.available = false;
  roomsMap.set(addedRoomId, room);
  SEND_EVENTS.update_room(ws);
  SEND_EVENTS.create_game(addedRoomId, ws);
}

function findSocketByUserId(userId) {
  return socketsMap.get(userId);
}

function createGame(roomId, ws) {
  const room = roomsMap.get(roomId);
  if (room.roomUsers.length < 2) {
    sendError("Need 2 users for game", ws);
    return;
  }
  const gameId = Date.now();
  gamesMap.set(gameId, {
    roomUsers: room.roomUsers,
  });
  room.roomUsers.forEach((user) => {
    const socket = findSocketByUserId(user.index);
    if (!socket) return;

    socket.send(
      JSON.stringify({
        type: "create_game",
        data: JSON.stringify({
          idGame: gameId,
          idPlayer: user.index,
        }),
      })
    );
  });
  roomsMap.delete(roomId);
  SEND_EVENTS.update_room();
}

function sendAllMessage(data) {
  wss.clients.forEach((client) => {
    client.send(data);
  });
}

function updateRoom(ws) {
  const roomsArr = Array.from(roomsMap);
  const allRooms = roomsArr.map((room) => room[1]);
  const rooms = allRooms.filter((room) => room.roomUsers.length !== 2);
  sendAllMessage(
    JSON.stringify({
      type: "update_room",
      data: JSON.stringify(rooms),
      id: 0,
    })
  );
}

function generateShipCells(ship) {
  const direction = ship.direction ? "vertical" : "horizontal";
  const startPosition = {
    x: ship.position.x,
    y: ship.position.y,
    state: "live",
  };
  const shipLength = ship.length;
  const cells = [{ ...startPosition }];
  for (let i = 1; i < shipLength; i += 1) {
    if (direction === "horizontal") {
      startPosition.x += 1;
      cells.push({ ...startPosition });
    } else {
      startPosition.y += 1;
      cells.push({ ...startPosition });
    }
  }
  return cells;
}

function addShips(data, ws) {
  const body = JSON.parse(data);
  const { gameId, ships, indexPlayer } = body;
  const game = gamesMap.get(gameId);
  const playerInfo = {
    indexPlayer,
    ships,
    shipsWithCells: ships.map((ship) => {
      const direction = ship.direction ? "vertical" : "horizontal";
      const newShip = {
        state: "live",
        direction,
        type: ship.type,
        cells: [],
      };
      if (ship.type === "small") {
        newShip.cells.push({
          x: ship.position.x,
          y: ship.position.y,
          state: "live",
        });
        return newShip;
      }
      newShip.cells.push(...generateShipCells(ship));
      return newShip;
    }),
    shotsHistory: [],
  };
  if (game.info && game.info.length) {
    game.info.push(playerInfo);
    SEND_EVENTS.start_game(gameId);
  } else {
    game.info = [playerInfo];
  }
}

function startGame(gameId, ws) {
  const game = gamesMap.get(gameId);
  const initTurnPlayer = game.info[0].indexPlayer;
  game.turn = initTurnPlayer;
  game.info.forEach((info) => {
    const socket = socketsMap.get(info.indexPlayer);
    if (!socket) return;
    socket.send(
      JSON.stringify({
        type: "start_game",
        data: JSON.stringify({
          ships: info.ships,
          currentPlayerIndex: info.indexPlayer,
        }),
        id: 0,
      })
    );
    socket.send(
      JSON.stringify({
        type: "turn",
        data: JSON.stringify({
          currentPlayer: initTurnPlayer,
        }),
        id: 0,
      })
    );
    if (game.info.some((i) => i.indexPlayer === "BOT") && game.turn === "BOT") {
      randomAttack(
        JSON.stringify({
          gameId,
          indexPlayer: "BOT",
        })
      );
    }
  });
  gamesMap.set(gameId, game);
}

function addWinForUser(userId) {
  const user = usersMap.get(userId);
  user.wins = user.wins + 1;
  usersMap.set(userId, user);
}

function getRandomCoordsByHistory(shotsHistory) {
  let attackCoords = null;
  while (!attackCoords) {
    const randomX = Math.floor(Math.random() * 9);
    const randomY = Math.floor(Math.random() * 9);
    const hasCoords = shotsHistory.find(
      (shot) => shot.x === randomX && shot.y === randomY
    );
    if (!hasCoords) {
      attackCoords = {
        x: randomX,
        y: randomY,
      };
      break;
    }
  }
  return {
    x: attackCoords.x,
    y: attackCoords.y,
  };
}

function randomAttack(data, ws) {
  const { gameId, indexPlayer } = JSON.parse(data);

  const game = gamesMap.get(gameId);
  const enemyInfo = game.info.find((i) => i.indexPlayer !== indexPlayer);
  const shotsHistory = enemyInfo.shotsHistory;
  let { x, y } = getRandomCoordsByHistory(shotsHistory);

  attack(
    JSON.stringify({
      gameId,
      x,
      y,
      indexPlayer,
    })
  );
}

function getCoordsAroundShip(ship) {
  const cells = ship.cells;
  const coords = [];
  // x = 1
  // y = 1
  /**
   * [[0, 0][1, 0][2, 0]]
   * [[0, 1][1, 1][2, 1]]
   * [[0, 2][1, 2][2, 2]]
   */
  const queueCalc = [
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  cells.forEach((cell) => {
    queueCalc.forEach((calc) => {
      const newCoord = {
        x: cell.x + calc.x,
        y: cell.y + calc.y,
        state: "kill",
      };
      if (
        cells.some((cell) => cell.x === newCoord.x && cell.y === newCoord.y)
      ) {
        newCoord.state = "shot";
      }
      coords.push(newCoord);
    });
  });
  return coords.filter((coord) => coord.x >= 0 && coord.y >= 0);
}

function attack(data, ws) {
  const body = JSON.parse(data);
  const { gameId, x, y, indexPlayer } = body;
  const game = gamesMap.get(gameId);
  const currentTurn = game.turn;
  if (currentTurn !== indexPlayer) {
    ws.send(
      JSON.stringify({
        message: "Wait turn other player",
      })
    );
    return;
  }

  const enemyInfo = game.info.find((i) => i.indexPlayer !== indexPlayer);
  const hasAttackCoords = enemyInfo.shotsHistory.find(
    (item) => item.x === x && item.y === y
  );
  if (hasAttackCoords) {
    ws.send(
      JSON.stringify({
        message: "Already shoted",
      })
    );
    return;
  }
  enemyInfo.shotsHistory.push({ x, y });
  const findedShipWithCells = enemyInfo.shipsWithCells.find((shipWithCells) =>
    shipWithCells.cells.some((cell) => cell.x === x && cell.y === y)
  );
  if (!findedShipWithCells) {
    const otherPlayerIndex = game.info.find(
      (i) => i.indexPlayer !== indexPlayer
    ).indexPlayer;
    game.turn = otherPlayerIndex;

    game.info.forEach((info) => {
      const socket = socketsMap.get(info.indexPlayer);
      if (!socket) return;
      socket.send(
        JSON.stringify({
          type: "attack",
          data: JSON.stringify({
            position: {
              x,
              y,
            },
            currentPlayer: indexPlayer,
            status: "miss",
          }),
          id: 0,
        })
      );
      socket.send(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify({
            currentPlayer: otherPlayerIndex,
          }),
          id: 0,
        })
      );
    });
    gamesMap.set(gameId, game);
    if (game.turn === "BOT") {
      randomAttack(
        JSON.stringify({
          gameId,
          indexPlayer: "BOT",
        })
      );
    }
  } else {
    findedShipWithCells.cells = findedShipWithCells.cells.map((cell) => {
      if (cell.x === x && cell.y === y && cell.state === "live") {
        return {
          ...cell,
          state: "shot",
        };
      } else {
        return cell;
      }
    });
    const isKilled = findedShipWithCells.cells.every(
      (cell) => cell.state === "shot"
    );
    let requestStatus = "shot";
    if (isKilled) {
      requestStatus = "killed";
      findedShipWithCells.state = "killed";
    }
    enemyInfo.shipWithCells = findedShipWithCells;
    game.info = game.info.map((i) => {
      if (i.indexPlayer === indexPlayer) {
        return i;
      } else {
        return enemyInfo;
      }
    });
    gamesMap.set(gameId, game);

    const isGameFinished = enemyInfo.shipsWithCells.every(
      (ship) => ship.state === "killed"
    );
    game.info.forEach((info) => {
      const socket = socketsMap.get(info.indexPlayer);
      if (!socket) return;

      const coordsAroundKilledShip = getCoordsAroundShip(findedShipWithCells);
      console.log("coordsAroundKilledShip", coordsAroundKilledShip);
      console.log("findedShipWithCells", findedShipWithCells);
      if (isKilled) {
        coordsAroundKilledShip.forEach((coord) => {
          socket.send(
            JSON.stringify({
              type: "attack",
              data: JSON.stringify({
                position: {
                  x: coord.x,
                  y: coord.y,
                },
                currentPlayer: indexPlayer,
                status: coord.state,
              }),
              id: 0,
            })
          );
        });
      } else {
        socket.send(
          JSON.stringify({
            type: "attack",
            data: JSON.stringify({
              position: {
                x,
                y,
              },
              currentPlayer: indexPlayer,
              status: requestStatus,
            }),
            id: 0,
          })
        );
      }
      socket.send(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify({
            currentPlayer: indexPlayer,
          }),
          id: 0,
        })
      );
      if (isGameFinished) {
        socket.send(
          JSON.stringify({
            type: "finish",
            data: JSON.stringify({
              winPlayer: indexPlayer,
            }),
            id: 0,
          })
        );
      }
    });
    if (isGameFinished) {
      const isGameWithBot = game.info.some((i) => i.indexPlayer === "BOT");
      if (!isGameWithBot) {
        addWinForUser(indexPlayer);
        updateWinners();
      }
      gamesMap.delete(gameId);
    }
    if (game.turn === "BOT") {
      randomAttack(
        JSON.stringify({
          gameId,
          indexPlayer: "BOT",
        })
      );
    }
  }
}

function turn() {}

function finish() {}

wss.on("connection", (ws, _, client) => {
  ws.on("error", console.error);

  ws.on("message", function message(data) {
    const body = JSON.parse(data);
    console.log("incoming message type: ", body.type);
    const handler = INCOMING_EVENTS[body.type];
    if (handler) {
      if (typeof body.data !== "string") return;
      handler(body.data, ws);
    }
  });
});
