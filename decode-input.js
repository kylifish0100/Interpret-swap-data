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

function identifyRouter(address) {
    const lowerCaseAddress = address.toLowerCase();
    const lowerCaseRouters = Object.values(Routers).flat().map(router => router.toLowerCase());

    // Check and return the corresponding value based on the address match
    if (lowerCaseAddress === lowerCaseRouters[0]) {
        return 1;
    } else if (lowerCaseAddress === lowerCaseRouters[1] || lowerCaseAddress === lowerCaseRouters[2]) {
        return 2;
    } else if (lowerCaseAddress === lowerCaseRouters[3] || lowerCaseAddress === lowerCaseRouters[4]) {
        return 3;
    } else {
        return 0; // or any other default value for no match
    }

}

function getValueFromDecodedData(valuetype, decodedData, routerType) {
    let param;
    let subParamObject;

    switch (routerType) {
        case '1': // Universal Router
            const inputs = decodedData.params[1];
            for (let i = 0; i < decodedData.params[1].value.length; i++) {
                subParamObject = abiDecoder.decodeMethod(inputs.value[i]);
                console.log(subParamObject);
            }
            
            break;
        case '2':// Uniswap V2 Router
            param = decodedData.params.find(p => p.name === valuetype);
            break;
        case '3':// Uniswap V3 Router
        {
            if((decodedData.name === 'exactInputSingle' || decodedData.name === 'exactOutputSingle') && valuetype === 'path'){
                param = [];
                param.push(decodedData.params[0].value.tokenIn);
                param.push(decodedData.params[0].value.tokenOut);
                break;
            } else if(decodedData.name === 'multicall'){
                param = [];
                const dataParam = decodedData.params.find(param => param.name === 'data');
                console.log(dataParam.value.length);
                for (let i = 0; i < decodedData.params[1].value.length; i++) {
                    subParamObject = abiDecoder.decodeMethod(dataParam.value[i]);
                    console.log(subParamObject.params);
                    const result = getValueFromDecodedData(valuetype, subParamObject, routerType);
                    // console.log(result)
                    if(Array.isArray(result)){
                        result.forEach(obj => {
                            param.push(obj);
                        });
                    }else if(result){
                        param.push(result);
                    }
                    // console.log(param);
                }
                if(valuetype === 'deadline' && param && param.length === 0){
                    param = decodedData.params.find(p => p.name === valuetype);
                }
                break;
            }

            const paramsObject = decodedData.params[0]; 
            // console.log(paramsObject);
            param = paramsObject && paramsObject.value ? paramsObject.value[valuetype] : undefined;
            break;
        }
        default:
            console.error('Invalid routerType');
            return null;
    }

    if (param != [] && param != undefined) {
        return param.value ? param.value : param; // Return param.value if it exists, else return param
    } else {
        console.error(`${valuetype} parameter not found`);
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
        const txnInfo = await provider.getTransaction(txnHash);
        const routerType = identifyRouter(txnInfo.to); 
        // console.log(txnInfo.to);   
        console.log(`Router type: ${routerType}`);
        console.log(decodedData)
        const swapPath = getValueFromDecodedData('path', decodedData, routerType.toString());
        const deadline = getValueFromDecodedData('deadline', decodedData, routerType.toString());
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
                let results = [];
                // Fetch the transaction details
                const tx = await provider.getTransaction(transaction);
                // console.log(tx);
                const routerType = identifyRouter(tx.to);
                // Check if the transaction is to one of the routers
                if (routerType) {
                    console.log(` Found swap transaction: ${tx.hash}, Using router type ${identifyRouter(tx.to)}`);
                    // Decode the transaction input
                    const decodedData = await decodeTxn(tx.hash); 
                    console.log(decodedData);
                    if (decodedData) {
                        // Decode swap transaction details and log the swap data
                        const swapPath = getValueFromDecodedData('path', decodedData, routerType.toString() );
                        const deadline = getValueFromDecodedData('deadline', decodedData, routerType.toString());
                        const inputToken = swapPath[0];
                        const outputToken = swapPath[swapPath.length - 1];
                        
                        const swapData = {
                            hash: tx.hash,
                            swapPath: swapPath,
                            inputToken: inputToken,
                            outputToken: outputToken,
                            deadline: deadline
                        };

                        results.push(swapData);
                        
                        const jsonData = JSON.stringify(results, null, 2);
          
                        fs.writeFile('swapData.json', jsonData + '\n', (err) => {
                            console.log('Data written to file');
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


// Test txn using Universal Router
// withKnownTxn("0xfcfb1f065abbdd260adab1e8eb0416f9e38c8987b2629de72e8b51f829ff20f7");
// Test txn using Uniswap V3 Router
// withKnownTxn("0xcac65f9d3409f347d05bd4cf5cda903d1277d01ba3e4d2ea5324cfcdf4e4901e");
// Analyse mempool pending transactions
processTxnInMempool();
