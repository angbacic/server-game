import {
  JsonController,
  Authorized,
  CurrentUser,
  Post,
  Param,
  BadRequestError,
  HttpCode,
  NotFoundError,
  ForbiddenError,
  Get,
  Body,
  Patch
} from "routing-controllers";
import User from "../users/entity";
import { Game, Player, Board, Word } from "./entities";
import { io } from "../index";
// import { Router } from 'express';
// import { IndexMetadata } from 'typeorm/metadata/IndexMetadata';

const words = [
  "HOMER",
  "MARGE",
  "LISA",
  "BART",
  "MAGGIE",
  "APU",
  "FLANDERS",
  "BURNS",
  "MILHOUSE",
  "MOE",
  "KRUSTY",
  "OTTO",
  "SPRINGFIELD",
  "SMITHERS",
  "DUFF",
  "DOH",
  "SPIDERPIG",
  "SKINNER",

  "RALPH",
  "BARNEY",
  "GROENING",
  "ELBARTO",
  "ITCHY",
  "SCRATCHY"
];
const letters = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z"
];
// const allOrientations= ['horizontal']
// const orientation= {horizontal: function(x,y,i) { return {x: x+i, y: y  }}}
// const checkOrientation ={horizontal: function(x,y,h,w,l) { return w >= x + l}}
// const skipOrientations = {horizontal: function(x,y,l) { return {x: 0, y: y+1}}}

@JsonController()
export default class GameController {
  @Authorized()
  @Post("/games")
  @HttpCode(201)
  async createGame(@CurrentUser() user: User) {
    function createRandomBoard() {
      const board: string[][] = [];
      for (let rowIndex = 0; rowIndex < 12; rowIndex++) {
        const row: string[] = [];
        for (let columnIndex = 0; columnIndex < 12; columnIndex++) {
          const randomLetterIndex = Math.floor(Math.random() * letters.length);
          const randomLetter = letters[randomLetterIndex];
          row.push(randomLetter);
        }
        board.push(row);
      }
      return board;
    }

    const board = createRandomBoard();

    console.log("words test: ", words);
    console.log("board test:", board);

    const entity = new Game();
    await entity.save();

    async function positionWord() {
      const randomWordIndex = Math.floor(Math.random() * words.length);
      console.log("randomWordIndex", randomWordIndex);
      const text = words[randomWordIndex];
      console.log("text test:", text);
      const randomRowIndex = Math.floor(Math.random() * board.length);
      console.log("randomRowIndex test", randomRowIndex);
      const row = board[randomRowIndex];
      const randomColumnIndex = Math.floor(Math.random() * (12 - text.length));
      console.log("randomColumnIndex test:", randomColumnIndex);
      text.split("").map((letter, index) => {
        row[randomColumnIndex + index] = letter;
      });

      const word = new Word();
      word.text = text;
      word.row = randomRowIndex;
      word.column = randomColumnIndex;
      word.game = entity;
      await word.save();
    }

    async function start() {
      for (let amount = 0; amount < 7; amount++) await positionWord();
    }

    await start();

    entity.board = board;
    await entity.save();
    await Player.create({
      game: entity,
      user
    }).save();

    const game = await Game.findOneById(entity.id);

    io.emit("action", {
      type: "ADD_GAME",
      payload: game
    });

    return game;
  }

  @Authorized()
  @Post("/games/:id([0-9]+)/players")
  @HttpCode(201)
  async joinGame(@CurrentUser() user: User, @Param("id") gameId: number) {
    const game = await Game.findOneById(gameId);
    if (!game) throw new BadRequestError(`Game does not exist`);
    if (game.status !== "pending")
      throw new BadRequestError(`Game is already started`);

    game.status = "started";
    await game.save();

    const player = await Player.create({
      game,
      user
    }).save();

    io.emit("action", {
      type: "UPDATE_GAME",
      payload: await Game.findOneById(game.id)
    });

    return player;
  }

  @Authorized()
  // the reason that we're using patch here is because this request is not idempotent
  // http://restcookbook.com/HTTP%20Methods/idempotency/
  // try to fire the same requests twice, see what happens
  @Patch("/games/:id([0-9]+)")
  async updateGame(
    @CurrentUser() user: User,
    @Param("id") gameId: number,
    @Body() position: number[]
  ) {
    const game = await Game.findOneById(gameId);
    if (!game) throw new NotFoundError(`Game does not exist`);

    const player = await Player.findOne({ user, game });
    console.log("player test:", player);

    if (!player) throw new ForbiddenError(`You are not part of this game`);
    if (game.status !== "started")
      throw new BadRequestError(`The game is not started yet`);

    const [rowIndex, columnIndex] = position;

    const correctWord = game.words.find(word => {
      return word.row === rowIndex && word.column === columnIndex;
    });
    console.log("correctWord test:", correctWord);

    if (correctWord) {
      player.words.push(correctWord);
      if (player.words.length >= 5) {
        player.winner = true;
        game.status = "finished";
        await game.save();
      }
      await player.save();
    }

    const newGame = await Game.findOneById(gameId);
    if (!newGame) throw new NotFoundError(`Game does not exist`);

    console.log("newGame test:", newGame);

    io.emit("action", {
      type: "UPDATE_GAME",
      payload: newGame
    });

    return newGame;
  }

  @Authorized()
  @Get("/games/:id([0-9]+)")
  getGame(@Param("id") id: number) {
    return Game.findOneById(id);
  }

  @Authorized()
  @Get("/games")
  getGames() {
    return Game.find();
  }
}
