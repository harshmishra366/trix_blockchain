const { ethers } = require('hardhat');
require('dotenv').config();

async function mintGTTokens() {
    try {
        console.log('🔄 Minting GT tokens...');
        
        // Connect to local Hardhat network
        const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');
        const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
        
        // Contract addresses from deployment
        const TOKEN_STORE_ADDRESS = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
        const GAME_TOKEN_ADDRESS = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
        const MOCK_USDT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
        
        // Your account address (replace with the account you want GT tokens for)
        const YOUR_ACCOUNT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // Account #1
        // You can also try: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // Account #2
        
        console.log(`Minting GT tokens for: ${YOUR_ACCOUNT}`);
        
        // Method 1: Mint USDT first, then buy GT tokens (proper way)
        console.log('Step 1: Minting USDT...');
        const usdtContract = new ethers.Contract(
            MOCK_USDT_ADDRESS,
            [
                'function mint(address to, uint256 amount) external',
                'function balanceOf(address) view returns (uint256)',
                'function approve(address spender, uint256 amount) external returns (bool)'
            ],
            signer
        );
        
        // Mint 10000 USDT (6 decimals)
        const usdtAmount = ethers.utils.parseUnits('10000', 6);
        const mintTx = await usdtContract.mint(YOUR_ACCOUNT, usdtAmount);
        await mintTx.wait();
        console.log('✅ Minted 10,000 USDT');
        
        // Check USDT balance
        const usdtBalance = await usdtContract.balanceOf(YOUR_ACCOUNT);
        console.log(`USDT Balance: ${ethers.utils.formatUnits(usdtBalance, 6)} USDT`);
        
        // Method 2: Direct GT token mint (if contract allows)
        console.log('Step 2: Attempting direct GT mint...');
        const gtContract = new ethers.Contract(
            GAME_TOKEN_ADDRESS,
            [
                'function mint(address to, uint256 amount) external',
                'function balanceOf(address) view returns (uint256)',
                'function owner() view returns (address)'
            ],
            signer
        );
        
        try {
            // Try to mint 1000 GT tokens directly (18 decimals)
            const gtAmount = ethers.utils.parseUnits('1000', 18);
            const mintGTTx = await gtContract.mint(YOUR_ACCOUNT, gtAmount);
            await mintGTTx.wait();
            console.log('✅ Minted 1,000 GT tokens directly');
            
            // Check GT balance
            const gtBalance = await gtContract.balanceOf(YOUR_ACCOUNT);
            console.log(`GT Balance: ${ethers.utils.formatUnits(gtBalance, 18)} GT`);
            
        } catch (error) {
            console.log('⚠️  Direct GT mint failed, using TokenStore purchase method...');
            
            // Use TokenStore to buy GT tokens
            const tokenStoreContract = new ethers.Contract(
                TOKEN_STORE_ADDRESS,
                [
                    'function buy(uint256 usdtAmount) external',
                    'event Purchase(address indexed buyer, uint256 usdtAmount, uint256 gtOut)'
                ],
                signer
            );
            
            // First connect to the account that has USDT
            const accountSigner = provider.getSigner(YOUR_ACCOUNT);
            const usdtWithAccount = usdtContract.connect(accountSigner);
            
            // Approve TokenStore to spend USDT
            console.log('Step 3: Approving USDT spend...');
            const buyAmount = ethers.utils.parseUnits('100', 6); // Buy with 100 USDT
            const approveTx = await usdtWithAccount.approve(TOKEN_STORE_ADDRESS, buyAmount);
            await approveTx.wait();
            console.log('✅ Approved USDT spend');
            
            // Buy GT tokens
            console.log('Step 4: Buying GT tokens...');
            const tokenStoreWithAccount = tokenStoreContract.connect(accountSigner);
            const buyTx = await tokenStoreWithAccount.buy(buyAmount);
            await buyTx.wait();
            console.log('✅ Purchased GT tokens');
            
            // Check final GT balance
            const finalGTBalance = await gtContract.balanceOf(YOUR_ACCOUNT);
            console.log(`Final GT Balance: ${ethers.utils.formatUnits(finalGTBalance, 18)} GT`);
        }
        
        console.log('🎉 Token minting complete!');
        console.log('📝 Summary:');
        console.log(`   Account: ${YOUR_ACCOUNT}`);
        console.log(`   USDT: ${ethers.utils.formatUnits(await usdtContract.balanceOf(YOUR_ACCOUNT), 6)} USDT`);
        console.log(`   GT: ${ethers.utils.formatUnits(await gtContract.balanceOf(YOUR_ACCOUNT), 18)} GT`);
        
    } catch (error) {
        console.error('❌ Error minting tokens:', error.message);
    }
}

mintGTTokens();
