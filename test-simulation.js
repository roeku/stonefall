// Quick test script to verify our simulation works
import { runSimulationTests } from '../shared/test/simulationTest';

async function main() {
  // console.log('Running Stonefall simulation tests...\n');

  try {
    const success = await runSimulationTests();
    if (success) {
      // console.log('\n✅ All simulation tests passed!');
      // console.log('The game is ready for development and testing.');
    } else {
      // console.log('\n❌ Some tests failed. Check the output above.');
    }
  } catch (error) {
    console.error('Error running tests:', error);
  }
}

// Run if this is the main module
if (require.main === module) {
  main();
}
