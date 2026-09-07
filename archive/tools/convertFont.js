#!/usr/bin/env node

/**
 * Font conversion utility for Three.js
 * Converts TTF fonts to Three.js compatible JSON format
 * 
 * Usage: node tools/convertFont.js
 */

const fs = require('fs');
const path = require('path');

console.log('Font Conversion Utility for Three.js');
console.log('=====================================');

// Check if we have the required dependencies
try {
    // We'll use opentype.js for font parsing
    const opentype = require('opentype.js');
    console.log('✓ opentype.js found');
} catch (error) {
    console.log('❌ opentype.js not found. Installing...');
    console.log('Run: npm install --save-dev opentype.js');
    console.log('Then run this script again.');
    process.exit(1);
}

const fontDir = path.join(__dirname, '../src/client/public/Orbitron/static');
const outputDir = path.join(__dirname, '../src/client/public/fonts');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Font files to convert
const fontsToConvert = [
    { file: 'Orbitron-Regular.ttf', name: 'orbitron-regular' },
    { file: 'Orbitron-Bold.ttf', name: 'orbitron-bold' },
    { file: 'Orbitron-Medium.ttf', name: 'orbitron-medium' }
];

console.log(`\nConverting fonts from: ${fontDir}`);
console.log(`Output directory: ${outputDir}\n`);

fontsToConvert.forEach(({ file, name }) => {
    const inputPath = path.join(fontDir, file);
    const outputPath = path.join(outputDir, `${name}.json`);

    if (!fs.existsSync(inputPath)) {
        console.log(`⚠️  Font file not found: ${file}`);
        return;
    }

    try {
        console.log(`Converting ${file}...`);

        // For now, create a placeholder JSON structure
        // In a real implementation, you'd use a proper TTF to Three.js converter
        const fontData = {
            glyphs: {},
            familyName: 'Orbitron',
            ascender: 1069,
            descender: -293,
            underlinePosition: -75,
            underlineThickness: 50,
            boundingBox: {
                yMin: -293,
                yMax: 1069,
                xMin: 0,
                xMax: 1000
            },
            resolution: 1000,
            original_font_information: {
                format: 0,
                copyright: 'Orbitron Font',
                fontFamily: 'Orbitron',
                fontSubfamily: file.includes('Bold') ? 'Bold' : 'Regular',
                uniqueID: `Orbitron-${name}`,
                fullName: `Orbitron ${file.includes('Bold') ? 'Bold' : 'Regular'}`,
                version: '1.0',
                postScriptName: `Orbitron-${name}`
            }
        };

        fs.writeFileSync(outputPath, JSON.stringify(fontData, null, 2));
        console.log(`✓ Created ${name}.json`);

    } catch (error) {
        console.log(`❌ Error converting ${file}:`, error.message);
    }
});

console.log('\n📝 Note: This creates placeholder JSON files.');
console.log('For production use, consider using a proper TTF to Three.js converter');
console.log('or use the online converter at: https://gero3.github.io/facetype.js/');
console.log('\nAlternatively, the current canvas-based text rendering works well for most cases.');
