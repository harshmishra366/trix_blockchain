require("dotenv").config({ path: '.env' });

console.log('Environment Variables:');
console.log('RPC_URL:', process.env.RPC_URL);
console.log('PRIVATE_KEY:', process.env.PRIVATE_KEY ? 'SET' : 'NOT SET');
console.log('TOKEN_STORE_ADDRESS:', process.env.TOKEN_STORE_ADDRESS);
console.log('PLAY_GAME_ADDRESS:', process.env.PLAY_GAME_ADDRESS);
