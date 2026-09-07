// Simple test for the tower placement system
import { TowerPlacementSystem } from './src/shared/types/towerPlacement.js';

console.log('Testing Tower Placement System...');

// Create a placement system
const system = new TowerPlacementSystem(8, 0, 0);

// Test getting coordinates
console.log('Center coordinate (0,0):', system.getCoordinate(0, 0));
console.log('Available coordinates count:', system.getAvailableCoordinates().length);
console.log('Occupied coordinates count:', system.getOccupiedCoordinates().length);

// Test placing a tower
const success = system.placeTower(1, 1, 'test-tower-1');
console.log('Placed tower at (1,1):', success);
console.log('Available coordinates after placement:', system.getAvailableCoordinates().length);

// Test getting coordinate by world position
const coord = system.getCoordinateByWorldPos(8, 8);
console.log('Coordinate at world position (8,8):', coord);

// Test updating grid
system.updateGrid(10, 5, 5);
console.log('Updated grid - center coordinate:', system.getCoordinate(0, 0));

console.log('Tower placement system test completed!');
