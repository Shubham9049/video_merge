const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
const path = require('path');
const fs = require('fs');

// Set the path to the ffmpeg and ffprobe binaries
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const app = express();
const port = 3000;

// Configure Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Function to re-encode videos to the same format and resolution
function reencodeVideo(inputVideo, outputVideo, callback) {
    ffmpeg(inputVideo)
        .outputOptions('-vf', 'scale=640:480') // Example resolution, change as needed
        .outputOptions('-c:v', 'libx264')
        .outputOptions('-c:a', 'aac')
        .outputOptions('-b:a', '192k') // Set audio bitrate
        .outputOptions('-ar', '44100') // Set audio sample rate
        .on('end', () => {
            console.log('Re-encoding finished: ' + outputVideo);
            callback(null, outputVideo);
        })
        .on('error', (err) => {
            console.error('Error re-encoding video: ' + err.message);
            callback(err);
        })
        .save(outputVideo);
}

// Function to merge videos using concat demuxer
function mergeVideos(inputVideos, outputVideo, callback) {
    const fileListPath = path.join('uploads', 'filelist.txt');

    // Create a file list for FFmpeg concat demuxer
    const fileListContent = inputVideos.map(video => `file '${path.resolve(video)}'`).join('\n');
    fs.writeFileSync(fileListPath, fileListContent);

    ffmpeg()
        .input(fileListPath)
        .inputOptions('-f', 'concat')
        .inputOptions('-safe', '0')
        .outputOptions('-c:v', 'libx264')
        .outputOptions('-c:a', 'aac')
        .outputOptions('-strict', 'experimental')
        .on('error', (err) => {
            console.error('Error: ' + err.message);
            if (callback) callback(err);
        })
        .on('end', () => {
            console.log('Merging finished!');
            fs.unlinkSync(fileListPath); // Clean up file list
            if (callback) callback(null);
        })
        .save(outputVideo);
}

// Endpoint to upload videos and merge them
app.post('/merge', upload.array('videos'), (req, res) => {
    const inputVideos = req.files.map(file => file.path);
    const reencodedVideos = [];

    // Re-encode all videos before merging
    let reencodeCount = 0;
    inputVideos.forEach((video, index) => {
        const outputReencoded = video + '_reencoded.mp4';
        reencodeVideo(video, outputReencoded, (err) => {
            if (err) {
                return res.status(500).json({ error: 'Error re-encoding video: ' + err.message });
            }
            reencodedVideos[index] = outputReencoded;
            reencodeCount++;
            if (reencodeCount === inputVideos.length) {
                const outputVideo = path.join('uploads', 'output.mp4');
                mergeVideos(reencodedVideos, outputVideo, (err) => {
                    // Clean up uploaded and re-encoded files
                    inputVideos.forEach(file => fs.unlinkSync(file));
                    reencodedVideos.forEach(file => fs.unlinkSync(file));

                    if (err) {
                        return res.status(500).json({ error: 'Error merging videos: ' + err.message });
                    }

                    res.download(outputVideo, (err) => {
                        if (err) {
                            console.error('Error sending file:', err);
                        }
                        fs.unlinkSync(outputVideo); // Clean up output file after download
                    });
                });
            }
        });
    });
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
