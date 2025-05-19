import { WebSocket } from "ws";

export interface DataBase {
  usersMap: Map<number, User>;
  roomsMap: Map<string, Room>;
  socketsMap: Map<string | number, WebSocketWithPlayerId>;
  gamesMap: Map<number, Game>;
}

export type ShipCellState = "kill" | "shot" | "live";

export interface Position {
  x: number;
  y: number;
  state?: ShipCellState;
}

export interface Ship {
  position: Position;
  direction: boolean | string;
  type: "huge" | "large" | "medium" | "small";
  length: number;
}

export interface ShipWithCells extends Omit<Ship, "position"> {
  state: "live" | "kill";
  cells: Cell[];
}

export type Cell = Position & { state: "live" | "shot" | "kill" };

export interface User {
  id: number;
  name: string;
  wins: number;
}

export interface RoomUser {
  name: string;
  index: number | "BOT";
}

export interface Room {
  roomId: string;
  available: boolean;
  roomUsers: RoomUser[];
}

export interface GameInfo {
  indexPlayer: number | "BOT";
  ships: Ship[];
  shipsWithCells: ShipWithCells[];
  shotsHistory: Position[];
}

export interface Game {
  roomUsers: RoomUser[];
  info?: GameInfo[];
  turn?: number | "BOT";
}

export interface WebSocketWithPlayerId extends WebSocket {
  playerId: number;
}

export interface IncomingMessage {
  type: string;
  data: string;
  id: number;
}

export interface OutgoingMessage {
  type: string;
  data: string;
  id: number;
}

export interface ErrorMessage {
  message: string;
}

export interface RegData {
  name: string;
  index: number;
  error: boolean;
  errorText: string;
}

export interface CreateGameData {
  idGame: number;
  idPlayer: number | string;
}

export interface StartGameData {
  ships: Ship[];
  currentPlayerIndex: number | string;
}

export interface TurnData {
  currentPlayer: number | "BOT";
}

export interface AttackData {
  position: Position;
  currentPlayer: number | "BOT";
  status: "miss" | "shot" | "kill" | "kill";
}

export interface FinishData {
  winPlayer: number | "BOT";
}

export interface Winner {
  name: string;
  wins: number;
}
