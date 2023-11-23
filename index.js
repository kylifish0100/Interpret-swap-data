var ethers = require("ethers");
require('dotenv').config();
  
const provider = new ethers.WebSocketProvider(process.env.AlchemyWS);

var init = function () {  
    provider.on("pending", (tx) => {
        provider.getTransaction(tx).then(function (transaction) {
      console.log(transaction);
    });
  });

  provider.on("error", async () => {
    console.log(`Unable to connect to ${ep.subdomain} retrying in 3s...`);
    setTimeout(init, 3000);
  });

};

init();
