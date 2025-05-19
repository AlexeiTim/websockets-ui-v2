import {
  addShips,
  addUserRoRoom,
  attack,
  randomAttack,
  reg,
  singlePlay,
} from "./incoming.js";
import {
  createGame,
  createRoom,
  sendReg,
  startGame,
  updateRoom,
  updateWinners,
} from "./send.js";

export const SEND_EVENTS = {
  reg: sendReg,
  update_winners: updateWinners,
  create_game: createGame,
  update_room: updateRoom,
  start_game: startGame,
};

export const INCOMING_EVENTS = {
  reg,
  create_room: createRoom,
  add_user_to_room: addUserRoRoom,
  attack,
  randomAttack,
  single_play: singlePlay,
  add_ships: addShips,
};
