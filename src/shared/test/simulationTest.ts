import { GameSimulation, DropInput } from '../simulation';

// Simple test to verify deterministic simulation
function testDeterministicSimulation() {
  const seed = 12345;
  const mode = 'rotating_block';

  const inputs: DropInput[] = [
    { tick: 60 }, // Drop at 1 second
    { tick: 120 }, // Drop at 2 seconds
    { tick: 180 }, // Drop at 3 seconds
  ];

  console.log('Testing deterministic simulation...');

  // Run the same simulation twice
  const result1 = GameSimulation.simulateGame(seed, inputs, mode);
  const result2 = GameSimulation.simulateGame(seed, inputs, mode);

  console.log('Result 1:', {
    score: result1.finalScore,
    blocks: result1.blockCount,
    maxCombo: result1.maxCombo,
  });

  console.log('Result 2:', {
    score: result2.finalScore,
    blocks: result2.blockCount,
    maxCombo: result2.maxCombo,
  });

  // Verify determinism
  const isDeterministic =
    result1.finalScore === result2.finalScore &&
    result1.blockCount === result2.blockCount &&
    result1.maxCombo === result2.maxCombo;

  console.log('Simulation is deterministic:', isDeterministic);

  return isDeterministic;
}

// Test fixed-point math
function testFixedPointMath() {
  console.log('\nTesting fixed-point math...');

  const simulation = new GameSimulation(12345, 'rotating_block');
  const state = simulation.createInitialState();

  console.log('Initial state:', {
    tick: state.tick,
    score: state.score,
    blocks: state.blocks.length,
    currentBlock: state.currentBlock
      ? {
          x: state.currentBlock.x,
          rotation: state.currentBlock.rotation,
          width: state.currentBlock.width,
        }
      : null,
  });

  // Step a few ticks to see movement
  let currentState = state;
  for (let i = 1; i <= 5; i++) {
    currentState = simulation.stepSimulation(currentState);
    console.log(`Tick ${i}:`, {
      currentBlock: currentState.currentBlock
        ? {
            x: currentState.currentBlock.x,
            rotation: currentState.currentBlock.rotation,
          }
        : null,
    });
  }
}

// Test compression
async function testCompression() {
  console.log('\nTesting compression...');

  const { ReplayCompression } = await import('../simulation/compression');

  const inputs: DropInput[] = [{ tick: 60 }, { tick: 120 }, { tick: 180 }, { tick: 240 }];

  try {
    const compressed = await ReplayCompression.compressInputs(inputs);
    console.log('Compressed length:', compressed.length);

    const decompressed = await ReplayCompression.decompressInputs(compressed);
    console.log('Original inputs:', inputs);
    console.log('Decompressed inputs:', decompressed);

    const isEqual = JSON.stringify(inputs) === JSON.stringify(decompressed);
    console.log('Compression/decompression successful:', isEqual);

    return isEqual;
  } catch (error) {
    console.error('Compression test failed:', error);
    return false;
  }
}

// Run all tests
export async function runSimulationTests() {
  console.log('=== Stonefall Simulation Tests ===');

  const deterministicTest = testDeterministicSimulation();
  testFixedPointMath();
  const compressionTest = await testCompression();

  const allPassed = deterministicTest && compressionTest;

  console.log('\n=== Test Results ===');
  console.log('Deterministic simulation:', deterministicTest ? 'PASS' : 'FAIL');
  console.log('Compression:', compressionTest ? 'PASS' : 'FAIL');
  console.log('Overall:', allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');

  return allPassed;
}
