#!/usr/bin/env node

var nodeLZ4 = require('lz4');
var fs = require('fs');
var XXH = require('xxhash');

var JAVA_MAGIC = new Buffer('LZ4Block');
var LZ4_MAGIC = new Buffer([0x04, 0x22, 0x4d, 0x18]);

var HEADER_LENGTH = 1 + 4 + 4 + 4;

var FLAGS = {
    VERSION: 64,
    BLOCK_INDEPENDENCE: 64,
    BLOCK_CHECKSUM: 32,
    CONTENT_SIZE: 16,
    CONTENT_CHECKSUM: 8,
    RESERVED: 4,
    DICTIONARY: 1
};

var BLOCK_SIZE = {
    M4: 7,
    M3: 6,
    K256: 5,
    K64: 4
};

var JavaLZ4 = {
    uncompress: function(cfg, callback) {
        var data;

        if (cfg.data) {
            data = cfg.data;
        }

        if (cfg.src) {
            data = fs.readFileSync(cfg.src);
        }

        if (data === undefined) {
            throw new Error('You must supply either a buffer "cfg.data" or a filename "cfg.src".');
        }

        var output = [];
        var offset = 0;
        while (offset < data.length) {
            // Read in the java block
            var header = this.decodeBlock(data, offset);

            if (header.compressedlength > 0){
                // create the lz4 block
                var block = this.createBlock(header);
                output.push(nodeLZ4.decode(block));
            }

            offset = header.offset;
        }

        output = Buffer.concat(output);


        if (cfg.dst) {
            var newFilename = cfg.dst;
            fs.exists(newFilename, function(exists) {

                if (exists) {
                    return console.log('File "' + newFilename + '" already exists, aborting!');
                }

                fs.writeFile(newFilename, output, function() {
                    if (typeof callback === 'function'){
                        callback(output);
                    }
                });

            });
        }

        if (typeof callback === 'function'){
            callback(output);
        }
    },
    checkJavaMagic: function(buff, offset) {
        var magic = buff.slice(offset, offset + JAVA_MAGIC.length);
        for (var i = 0; i < JAVA_MAGIC.length; i++) {
            if (magic[i] !== JAVA_MAGIC[i]) {
                throw new Error('Invalid magic. ' + magic);
            }
        }
    },

    // Decode the jpountz/lz4-java block
    decodeBlock: function(buff, offset) {

        this.checkJavaMagic(buff, offset);
        offset += JAVA_MAGIC.length;

        var header = buff.slice(offset, offset + HEADER_LENGTH);

        var headerOffset = 0;
        var token = header[0];
        headerOffset += 1;

        var compressedlength = header.readInt32LE(headerOffset);
        headerOffset += 4;

        var uncompressedlength = header.readInt32LE(headerOffset);
        headerOffset += 4;

        var checksum = header.readInt32LE(headerOffset);
        headerOffset += 4;

        offset += HEADER_LENGTH;

        var compressedData = buff.slice(offset, offset + compressedlength);

        offset += compressedlength;

        return {
            token: token,
            compressedlength: compressedlength,
            uncompressedlength: uncompressedlength,
            checksum: checksum,
            data: compressedData,
            offset: offset
        };
    },

    // create the standard LZ4 block
    createBlock: function(blockInfo) {
        var block = new Buffer(blockInfo.data.length + LZ4_MAGIC.length + 7);
        var offset = 0;
        LZ4_MAGIC.copy(block, 0);
        offset = LZ4_MAGIC.length;

        block.writeUInt8(FLAGS.VERSION, offset);
        offset += 1;

        // default to the 4M block
        block.writeUInt8(BLOCK_SIZE.M4 << 4, offset);
        offset += 1;

        // create a check sum of the header
        var header = block.slice(LZ4_MAGIC.length, offset);
        var headerChecksum = (XXH.hash(header, 0) >> 8) & 0xFF;

        block.writeUInt8(headerChecksum, offset);
        offset += 1;

        block.writeInt32LE(blockInfo.compressedlength, offset);
        offset += 4;

        blockInfo.data.copy(block, offset);

        return block;
    }
};


module.exports = JavaLZ4;



function main() {
    var commander = require('commander');

    commander.version('0.0.1')
        .option('-o, --output [dest]', 'destination file')
        .usage('[options] <file ...> ')
        .parse(process.argv);


    if (commander.output && commander.args.length > 1) {
        console.log('Only one file can be supplied with "output".');
        commander.help();
    }
    if (commander.args.length === 0) {
        console.log('No files supplied');
        commander.help();
    }

    if (commander.output) {
        var obj = {
            src: commander.args.pop(),
            dst: commander.output
        };
        return JavaLZ4.uncompress(obj);
    }

    var index = -1;

    function decompress() {
        index ++;
        if (index >= commander.args.length) {
            return;
        }
        var filename = commander.args[index];



        if (filename.lastIndexOf('.lz4') !== filename.length - 4) {
            console.log('Refusing to decompress "' + filename + '" as it doest end with ".lz4"');
            return decompress();
        }

        console.log('Decompressing "' + filename + '"');
        var obj = {
            src: filename,
            dst: filename.substring(0, filename.length - 4)
        };

        JavaLZ4.uncompress(obj, decompress);
    }

    decompress();
}


if (require.main === module) {
    main();
}
