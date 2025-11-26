import { GameEngine } from './gameEngine.js';

const gameEngine = new GameEngine('gameCanvas');

// Start the game
async function init() {
    try {
        await gameEngine.start();
        console.log('Game initialized');
        
        // Start game loop
        let lastTime = performance.now();
        
        function gameLoop(currentTime) {
            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;
            
            gameEngine.update(deltaTime);
            gameEngine.render();
            
            requestAnimationFrame(gameLoop);
        }
        
        requestAnimationFrame(gameLoop);
        
    } catch (error) {
        console.error('Failed to initialize game:', error);
    }
}
    

// Start when page loads
window.addEventListener('load', init);

// Expose for debugging
window.gameEngine = gameEngine;
window.setupAudio = (callback) => gameEngine.setupAudioInput(callback);
