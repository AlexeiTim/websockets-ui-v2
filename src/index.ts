import { WebSocketServer } from "ws";
import { httpServer } from "./http_server/index.js";
import { getBotShipsVariant } from "./botShips.js";

import {
  User,
  Room,
  Game,
  WebSocketWithPlayerId,
  IncomingMessage,
  RegData,
  CreateGameData,
  StartGameData,
  TurnData,
  AttackData,
  FinishData,
  Winner,
  Position,
  Ship,
  ShipWithCells,
  GameInfo,
  Cell,
} from "./types";

const wss = new WebSocketServer({
  port: 3000,
});

const HTTP_PORT = 8181;

console.log(`Start static http server on the ${HTTP_PORT} port!`);
httpServer.listen(HTTP_PORT);

const usersMap = new Map<number, User>();
const roomsMap = new Map<string, Room>();
const socketsMap = new Map<number | string, WebSocketWithPlayerId>();
const gamesMap = new Map<number, Game>();

function getWinners(): Winner[] {
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
  reg,
  create_room: createRoom,
  add_user_to_room: addUserRoRoom,
  attack,
  randomAttack,
  single_play: singlePlay,
  add_ships: addShips,
};

function generateShipCells(ship: Ship): Array<Position & { state: "live" }> {
  const direction = ship.direction ? "vertical" : "horizontal";
  const startPosition = {
    x: ship.position.x,
    y: ship.position.y,
    state: "live" as const,
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

function singlePlay(data: string, ws: WebSocketWithPlayerId): void {
  const currentUser = usersMap.get(ws.playerId);
  if (!currentUser) return;

  const createdRoom = generateRoom(
    {
      name: "BOT",
      id: "BOT",
    },
    ws
  );
  addUserRoRoom(
    JSON.stringify({
      indexRoom: createdRoom.roomId,
    }),
    ws
  );
  roomsMap.delete(createdRoom.roomId);
  const actualGame = Array.from(gamesMap).find(([gameId, gameInfo]) => {
    return gameInfo.roomUsers.some(
      (roomUser) =>
        roomUser.index === "BOT" || roomUser.index === currentUser.id
    );
  });
  if (!actualGame) return;

  const generatedShips = getBotShipsVariant();
  addShips(
    JSON.stringify({
      gameId: actualGame[0],
      ships: generatedShips,
      indexPlayer: "BOT",
    })
  );
}

function sendReg(data: RegData, ws: WebSocketWithPlayerId): void {
  ws.send(
    JSON.stringify({
      type: "reg",
      data: JSON.stringify(data),
      id: 0,
    })
  );
}

function reg(data: string, ws: WebSocketWithPlayerId): void {
  const id = Date.now();
  const parsedData = JSON.parse(data);
  const hasUser = Array.from(usersMap).find(
    ([_, user]) => user.name === parsedData.name
  );
  if (hasUser) {
    sendError("User exists", ws);
    return;
  }
  usersMap.set(id, {
    id,
    ...parsedData,
    wins: 0,
  });
  const requestData: RegData = {
    name: parsedData.name,
    index: id,
    error: false,
    errorText: "",
  };

  SEND_EVENTS.reg(requestData, ws);
  SEND_EVENTS.update_room();
  SEND_EVENTS.update_winners();
  ws.playerId = id;
  socketsMap.set(id, ws);
}

function updateWinners(): void {
  const winners = getWinners();
  sendAllMessage(
    JSON.stringify({
      type: "update_winners",
      data: JSON.stringify(winners),
      id: 0,
    })
  );
}

function generateRoom(
  user: { name: string; id: number | "BOT" },
  ws: WebSocketWithPlayerId
): Room {
  const roomId = String(Date.now());

  const createRoomData: Room = {
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
  SEND_EVENTS.update_room();
  return createRoomData;
}

function createRoom(data: string, ws: WebSocketWithPlayerId): void {
  const user = usersMap.get(ws.playerId);
  if (!user) return;

  const createRoomData = generateRoom(user, ws);
  addUserRoRoom(
    JSON.stringify({
      indexRoom: createRoomData.roomId,
    }),
    ws
  );
}

function sendError(message: string, ws: WebSocketWithPlayerId): void {
  ws.send(
    JSON.stringify({
      message,
    })
  );
}

function addUserRoRoom(data: string, ws: WebSocketWithPlayerId): void {
  const currentUser = usersMap.get(ws.playerId);
  if (!currentUser) return;

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
  SEND_EVENTS.create_game(addedRoomId, ws);
  SEND_EVENTS.update_room();
}

function findSocketByUserId(
  userId: number | string
): WebSocketWithPlayerId | undefined {
  return socketsMap.get(userId);
}

function createGame(roomId: string, ws: WebSocketWithPlayerId): void {
  const room = roomsMap.get(roomId);
  if (!room) {
    sendError("Room not found", ws);
    return;
  }
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

    const createGameData: CreateGameData = {
      idGame: gameId,
      idPlayer: user.index,
    };

    socket.send(
      JSON.stringify({
        type: "create_game",
        data: JSON.stringify(createGameData),
        id: 0,
      })
    );
  });
  roomsMap.delete(roomId);
}

function sendAllMessage(data: string): void {
  wss.clients.forEach((client) => {
    client.send(data);
  });
}

function updateRoom(): void {
  const roomsArr = Array.from(roomsMap);
  const games = Array.from(gamesMap);
  console.log("rooms", roomsArr);
  console.log("games", games);
  const rooms = roomsArr
    .map((room) => room[1])
    .filter((room) => {
      const allUsersInGame = room.roomUsers.length === 2;
      if (allUsersInGame) {
        return false;
      }
      console.log(games);
      const gameWithSomePlayer = games.find(([gameId, gameInfo]) => {
        const gameUsersIndexes = gameInfo.roomUsers.map((user) => user.index);
        const hasUserIndexInRoom = room.roomUsers.some((user) =>
          gameUsersIndexes.some((gameUserIdx) => gameUserIdx === user.index)
        );
        if (hasUserIndexInRoom) return true;
      });
      console.log("gameWithSomePlayer", gameWithSomePlayer);
      if (gameWithSomePlayer) return false;

      return true;
    });

  sendAllMessage(
    JSON.stringify({
      type: "update_room",
      data: JSON.stringify(rooms),
      id: 0,
    })
  );
}

function addShips(data: string): void {
  const body = JSON.parse(data);
  const { gameId, ships, indexPlayer } = body;
  const game = gamesMap.get(gameId);
  if (!game) return;

  const playerInfo: GameInfo = {
    indexPlayer,
    ships,
    shipsWithCells: ships.map((ship: Ship) => {
      const direction = ship.direction ? "vertical" : "horizontal";
      const newShip: ShipWithCells = {
        state: "live",
        direction,
        type: ship.type,
        cells: [],
        length: ship.length,
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
  console.log("player info", playerInfo);
  if (game.info && game.info.length) {
    game.info.push(playerInfo);
    SEND_EVENTS.start_game(gameId);
  } else {
    game.info = [playerInfo];
  }
}

function startGame(gameId: number): void {
  const game = gamesMap.get(gameId);
  if (!game || !game.info) return;

  const initTurnPlayer = game.info[0].indexPlayer;
  game.turn = initTurnPlayer;
  game.info.forEach((info) => {
    const socket = socketsMap.get(info.indexPlayer);
    if (!socket) return;

    const startGameData: StartGameData = {
      ships: info.ships,
      currentPlayerIndex: info.indexPlayer,
    };

    socket.send(
      JSON.stringify({
        type: "start_game",
        data: JSON.stringify(startGameData),
        id: 0,
      })
    );

    const turnData: TurnData = {
      currentPlayer: initTurnPlayer,
    };

    socket.send(
      JSON.stringify({
        type: "turn",
        data: JSON.stringify(turnData),
        id: 0,
      })
    );
    if (
      game.info?.some((i) => i.indexPlayer === "BOT") &&
      game.turn === "BOT"
    ) {
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

function addWinForUser(userId: number): void {
  const user = usersMap.get(userId);
  if (!user) return;
  user.wins = user.wins + 1;
  usersMap.set(userId, user);
}

function getRandomCoordsByHistory(shotsHistory: Position[]): Position {
  let attackCoords: Position | null = null;
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
  return attackCoords!;
}

function randomAttack(data: string): void {
  const { gameId, indexPlayer } = JSON.parse(data);

  const game = gamesMap.get(gameId);
  if (!game || !game.info) return;

  const enemyInfo = game.info.find((i) => i.indexPlayer !== indexPlayer);
  if (!enemyInfo) return;

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

function getCoordsAroundShip(ship: ShipWithCells): Cell[] {
  const cells = ship.cells;
  const coords: Cell[] = [];
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
      const newCoord: Cell = {
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

function attack(data: string): void {
  const body = JSON.parse(data);
  const { gameId, x, y, indexPlayer } = body;
  const game = gamesMap.get(gameId);
  if (!game || !game.info) return;

  const currentTurn = game.turn;
  if (currentTurn !== indexPlayer) {
    const socket = socketsMap.get(indexPlayer);
    if (socket) {
      socket.send(
        JSON.stringify({
          message: "Wait turn other player",
        })
      );
    }
    return;
  }

  const enemyInfo = game.info.find((i) => i.indexPlayer !== indexPlayer);
  if (!enemyInfo) return;

  const hasAttackCoords = enemyInfo.shotsHistory.find(
    (item) => item.x === x && item.y === y
  );
  if (hasAttackCoords) {
    const socket = socketsMap.get(indexPlayer);
    if (socket) {
      socket.send(
        JSON.stringify({
          message: "Already shoted",
        })
      );
    }
    return;
  }
  enemyInfo.shotsHistory.push({ x, y });
  const findedShipWithCells = enemyInfo.shipsWithCells.find((shipWithCells) =>
    shipWithCells.cells.some((cell) => cell.x === x && cell.y === y)
  );
  if (!findedShipWithCells) {
    const otherPlayerIndex = game.info.find(
      (i) => i.indexPlayer !== indexPlayer
    )?.indexPlayer;
    if (!otherPlayerIndex) return;

    game.turn = otherPlayerIndex;

    game.info.forEach((info) => {
      const socket = socketsMap.get(info.indexPlayer);
      if (!socket) return;

      const attackData: AttackData = {
        position: { x, y },
        currentPlayer: indexPlayer,
        status: "miss",
      };

      socket.send(
        JSON.stringify({
          type: "attack",
          data: JSON.stringify(attackData),
          id: 0,
        })
      );

      const turnData: TurnData = {
        currentPlayer: otherPlayerIndex,
      };

      socket.send(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify(turnData),
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
    let requestStatus: "shot" | "kill" = "shot";
    if (isKilled) {
      requestStatus = "kill";
      findedShipWithCells.state = "kill";
    }
    console.log("START");
    console.log("findedShipWithCells", findedShipWithCells);
    console.log("enemyInfo shipithCells", enemyInfo.shipsWithCells);
    console.log("END");
    enemyInfo.shipsWithCells = enemyInfo.shipsWithCells.map((ship) =>
      ship === findedShipWithCells ? findedShipWithCells : ship
    );
    game.info = game.info.map((i) => {
      if (i.indexPlayer === indexPlayer) {
        return i;
      } else {
        return enemyInfo;
      }
    });
    gamesMap.set(gameId, game);
    console.log("enemyInfo.shipsWithCells", enemyInfo.shipsWithCells);
    const isGameFinished = enemyInfo.shipsWithCells.every(
      (ship) => ship.state === "kill"
    );
    game.info.forEach((info) => {
      const socket = socketsMap.get(info.indexPlayer);
      if (!socket) return;

      const coordsAroundKilledShip = getCoordsAroundShip(findedShipWithCells);
      if (isKilled) {
        coordsAroundKilledShip.forEach((coord) => {
          const attackData: AttackData = {
            position: { x: coord.x, y: coord.y },
            currentPlayer: indexPlayer,
            status: coord.state as AttackData["status"],
          };

          socket.send(
            JSON.stringify({
              type: "attack",
              data: JSON.stringify(attackData),
              id: 0,
            })
          );
        });
      } else {
        const attackData: AttackData = {
          position: { x, y },
          currentPlayer: indexPlayer,
          status: requestStatus,
        };

        socket.send(
          JSON.stringify({
            type: "attack",
            data: JSON.stringify(attackData),
            id: 0,
          })
        );
      }

      const turnData: TurnData = {
        currentPlayer: indexPlayer,
      };

      socket.send(
        JSON.stringify({
          type: "turn",
          data: JSON.stringify(turnData),
          id: 0,
        })
      );
      if (isGameFinished) {
        const finishData: FinishData = {
          winPlayer: indexPlayer,
        };

        socket.send(
          JSON.stringify({
            type: "finish",
            data: JSON.stringify(finishData),
            id: 0,
          })
        );
      }
    });
    if (isGameFinished) {
      const isGameWithBot = game.info.some((i) => i.indexPlayer === "BOT");
      if (!isGameWithBot && typeof indexPlayer === "number") {
        addWinForUser(indexPlayer);
      }
      gamesMap.delete(gameId);
      updateWinners();
      updateRoom();
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

function turn(): void {}

function finish(): void {}

const disconnect = (ws: WebSocketWithPlayerId) => {
  console.log("ws disconnect");
  if (ws.playerId) {
    console.log("reg user disconnected with id: " + ws.playerId);
    usersMap.delete(ws.playerId);
    socketsMap.delete(ws.playerId);
    const rooms = Array.from(roomsMap);
    rooms.forEach(([roomId, roomData]) => {
      const hasDisconnectedUser = roomData.roomUsers.find(
        (room) => room.index === ws.playerId
      );
      if (hasDisconnectedUser) {
        roomsMap.delete(roomId);
      }
    });
    const games = Array.from(gamesMap);
    games.forEach(([gameId, gameInfo]) => {
      const hasUserInGame = gameInfo.roomUsers.find(
        (user) => user.index === ws.playerId
      );
      if (hasUserInGame) {
        gamesMap.delete(gameId);
      }
    });
    updateRoom();
    updateWinners();
  }
};

const connection = (ws: WebSocketWithPlayerId) => {
  console.log("connection");
  ws.on("error", console.error);

  ws.on("message", function message(data: string) {
    const body: IncomingMessage = JSON.parse(data);
    console.log("incoming message type: ", body.type);
    const handler = INCOMING_EVENTS[body.type as keyof typeof INCOMING_EVENTS];
    if (handler) {
      if (typeof body.data !== "string") return;
      handler(body.data, ws);
    }
  });

  ws.on("close", disconnect);
};

wss.on("connection", connection);
