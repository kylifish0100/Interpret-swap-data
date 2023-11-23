const abiDecoder = require('abi-decoder'); 
const { ethers } = require('ethers');
const { Web3 } = require('web3');
const axios = require('axios');
const fs = require('fs');
const { get } = require('http');
const { Network, Alchemy } = require('alchemy-sdk');
require('dotenv').config();


const settings = {
    apiKey: "AlchemyKey",
    network: Network.ETH_MAINNET,
};

const alchemy = new Alchemy(settings);

// Connect to an Ethereum node 
const provider = new ethers.AlchemyProvider("homestead", process.env.AlchemyKey);
const WSprovider = new ethers.WebSocketProvider(process.env.AlchemyWS);

const Routers = {
    'Universal': ['0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad'],
    'UniswapV2': ['0xf164fC0Ec4E93095b804a4795bBe1e041497b92a', '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'],
    'UniswapV3': ['0xE592427A0AEce92De3Edee1F18E0157C05861564', '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45']
}

async function getContractABI(contractAddress) {
    const apiKey = process.env.EtherscanKey; //  fetch Etherscan API key in .env
    const url = `https://api.etherscan.io/api?module=contract&action=getabi&address=${contractAddress}&apikey=${apiKey}`;

    try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status === '1' && data.message === 'OK') {
            return JSON.parse(data.result);
        } else {
            throw new Error('ABI not found');
        }
    } catch (error) {
        console.error('Error fetching ABI:', error);
        return null; // or handle the error as needed
    }
}


async function decodeTxn(txHash) {
    try {
        // Fetch the transaction
        const tx = await provider.getTransaction(txHash);
        const decodedData = abiDecoder.decodeMethod(tx.data);
        return decodedData;
    } catch (err) {
        console.error(err);
        return null; // or handle the error as needed
    }
}

function getValueFromDecodedData(valuetype, decodedData) {
    // Find the parameter mathching the type we seek
    let param;
    if(valuetype === 'path') {
        param = decodedData.params.find(param => param.name === 'path' || param.name === 'inputs');
    }else{
        param = decodedData.params.find(param => param.name === valuetype);
    }
    // If we find it, return it's value
    if (param) {
        return param.value;
    } else {
        // Return an empty array or handle the error as you see fit
        console.error(`${valuetype} parameter not found or is not an array`);
        return null;
    }
}

async function addRoutersABI(Routers) {
    for (const group in Routers) {
        const routerGroup = Routers[group];
        for (const router of routerGroup) {
            try {
                const routerAbi = await getContractABI(router);
                abiDecoder.addABI(routerAbi);
            } catch (error) {
                console.error(`Error fetching ABI for ${routerName} at ${address}:`, error);
            }
        }
    }
}

async function withKnownTxn(txnHash) {
    try {
        // Initialize abi-decoder with the ABI of all router contracts
        await addRoutersABI(Routers);
        const decodedData = await decodeTxn(txnHash); 
        const swapPath = getValueFromDecodedData('path', decodedData);
        const deadline = getValueFromDecodedData('deadline', decodedData);
        const inputToken = swapPath[0];
        const outputToken = swapPath[swapPath.length - 1];
        console.log(`Input token: ${inputToken}, Output token: ${outputToken}`);
        const swapData = {
            swapPath: swapPath,
            inputToken: inputToken,
            outputToken: outputToken,
            deadline: deadline
          };
          
          const jsonData = JSON.stringify(swapData, null, 2);
          
          fs.writeFile('swapData.json', jsonData, (err) => {
            if (err) throw err;
            console.log('Data written to file');
          });
    } catch (err) {
        console.error('Error:', err);
    }
}


async function processTxnInMempool() {
    try {
        // Add router ABIs to abi-decoder
        await addRoutersABI(Routers);
        
        WSprovider.on("pending", async (transaction) => {
            try {
                // Fetch the transaction details
                const tx = await provider.getTransaction(transaction);
                
                // Check if the transaction is to one of the routers
                if (tx && tx.to && Object.values(Routers).flat().includes(tx.to.toLowerCase())) {
                    console.log('Found swap transaction:', tx.hash);
                    // Decode the transaction input
                    const decodedData = await decodeTxn(tx.hash); 
                    console.log(decodedData);
                    if (decodedData) {
                        // Decode swap transaction details and log the swap data
                        const swapPath = getValueFromDecodedData('path', decodedData);
                        const deadline = getValueFromDecodedData('deadline', decodedData);
                        const inputToken = swapPath[0];
                        const outputToken = swapPath[swapPath.length - 1];
                        
                        const swapData = {
                            swapPath: swapPath,
                            inputToken: inputToken,
                            outputToken: outputToken,
                            deadline: deadline
                        };
                        
                        const jsonData = JSON.stringify(swapData, null, 2);
          
                        fs.appendFile('swapData.json', jsonData + '\n', (err) => {
                            if (err) {
                                console.error('Error appending to file:', err);
                            }
                        });
                    }
                }
            } catch (txError) {
                console.error('Error processing transaction:', txError);
            }
        });
    } catch (err) {
        console.error('Error initializing subscription:', err);
    }
}

// Call the main function
processTxnInMempool();
