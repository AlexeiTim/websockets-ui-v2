import { wss } from "./index.js";
import { botShipsVariants } from "./consts.js";
import { DATA_BASE } from "./db.js";
import { SEND_EVENTS } from "./events/index.js";
import {
  Cell,
  Position,
  Room,
  Ship,
  ShipWithCells,
  WebSocketWithPlayerId,
  Winner,
} from "./types.js";

export function getWinners(): Winner[] {
  const usersArr = Array.from(DATA_BASE.usersMap);
  const users = usersArr.map((item) => item[1]);
  return users.map((user) => ({
    name: user.name,
    wins: user.wins,
  }));
}

export function generateShipCells(
  ship: Ship
): Array<Position & { state: "live" }> {
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

export function sendError(message: string, ws: WebSocketWithPlayerId): void {
  ws.send(
    JSON.stringify({
      message,
    })
  );
}

export function getBotShipsVariant(): Ship[] {
  const maxVariants = botShipsVariants.length;
  const randomVariant = Math.floor(Math.random() * maxVariants);
  return botShipsVariants[randomVariant];
}

export function sendAllMessage(data: string): void {
  console.log("Send message for all", data);
  wss.clients.forEach((client) => {
    client.send(data);
  });
}

export function generateRoom(user: { name: string; id: number | "BOT" }): Room {
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
  DATA_BASE.roomsMap.set(roomId, createRoomData);
  SEND_EVENTS.update_room();
  return createRoomData;
}

export function sendMessage(message: string, ws: WebSocketWithPlayerId): void {
  console.log("Send message", message);
  ws.send(message);
}

export function findSocketByUserId(
  userId: number | string
): WebSocketWithPlayerId | undefined {
  return DATA_BASE.socketsMap.get(userId);
}

export function getCoordsAroundShip(ship: ShipWithCells): Cell[] {
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

export function getRandomCoordsByHistory(shotsHistory: Position[]): Position {
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

export function addWinForUser(userId: number): void {
  const user = DATA_BASE.usersMap.get(userId);
  if (!user) return;
  user.wins = user.wins + 1;
  DATA_BASE.usersMap.set(userId, user);
}
