// Quick test to verify the improved block spawning behavior
const { GameSimulation } = require('./dist/shared/simulation/index.js');

console.log('Testing improved block spawning...');

try {
    // Create a new game simulation
    const simulation = new GameSimulation(12345, 'rotating_block');
    let state = simulation.createInitialState();

    console.log('Initial state created');
    console.log('First block position:', {
        x: state.currentBlock?.x,
        z: state.currentBlock?.z,
        y: state.currentBlock?.y
    });

    // Step through a few ticks to see movement
    for (let i = 1; i <= 10; i++) {
        state = simulation.stepSimulation(state);
        if (state.currentBlock) {
            console.log(`Tick ${i}: Block at (${state.currentBlock.x}, ${state.currentBlock.z})`);
        }
    }

    console.log('✅ Block spawning test completed successfully');
} catch (error) {
    console.error('❌ Test failed:', error.message);
}
