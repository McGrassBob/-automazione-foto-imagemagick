const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;


// ============================================================
// UPLOAD TEMPORANEI
// ============================================================

const upload = multer({
  dest: os.tmpdir(),

  limits: {
    fileSize: 80 * 1024 * 1024
  }
});


// ============================================================
// JOB IN MEMORIA
// ============================================================

const jobs = new Map();


// ============================================================
// UTILITY
// ============================================================

function clamp(value, min, max, fallback) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return Math.max(
    min,
    Math.min(max, n)
  );
}


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {

  res.json({
    ok: true,
    service: "automazione-foto-imagemagick",
    message: "ImageMagick service online",
    async: true,
    advancedControls: true
  });
});


// ============================================================
// SVILUPPO IMMAGINE
// ============================================================

function developImage(
  inputPath,
  outputPath,
  values
) {

  return new Promise(
    (resolve, reject) => {

      // ------------------------------------------------------
      // PARAMETRI BASE
      // ------------------------------------------------------

      const brightness =
        clamp(
          values.brightness,
          85,
          120,
          100
        );

      const gamma =
        clamp(
          values.gamma,
          0.75,
          1.25,
          1
        );

      const contrast =
        clamp(
          values.contrast,
          -20,
          20,
          0
        );

      const saturation =
        clamp(
          values.saturation,
          75,
          125,
          100
        );

      const temperature =
        clamp(
          values.temperature,
          -80,
          80,
          0
        );

      const tint =
        clamp(
          values.tint,
          -60,
          60,
          0
        );

      const sharpen =
        clamp(
          values.sharpen,
          0,
          1.5,
          0.3
        );


      // ------------------------------------------------------
      // NUOVI CONTROLLI
      // ------------------------------------------------------

      const shadows =
        clamp(
          values.shadows,
          -50,
          50,
          0
        );

      const highlights =
        clamp(
          values.highlights,
          -50,
          50,
          0
        );

      const whites =
        clamp(
          values.whites,
          -30,
          30,
          0
        );

      const blacks =
        clamp(
          values.blacks,
          -30,
          30,
          0
        );

      const vibrance =
        clamp(
          values.vibrance,
          -30,
          30,
          0
        );

      const quality =
        clamp(
          values.quality,
          80,
          100,
          95
        );


      // ======================================================
      // CONVERSIONI
      //
      // I nuovi cursori non esistono 1:1 in ImageMagick
      // come in Lightroom.
      //
      // Li traduciamo in curve/levels selettivi.
      // ======================================================


      // ------------------------------------------------------
      // SHADOWS
      //
      // Valore positivo:
      // apre i mezzi toni bassi.
      //
      // Valore negativo:
      // li chiude.
      //
      // Usiamo sigmoidal contrast con midpoint basso.
      // ------------------------------------------------------

      const shadowsStrength =
        Math.abs(shadows) *
        0.10;


      // ------------------------------------------------------
      // HIGHLIGHTS
      //
      // Valore negativo:
      // recupera/comprime le alte luci.
      //
      // Valore positivo:
      // le rende più brillanti.
      // ------------------------------------------------------

      const highlightsStrength =
        Math.abs(highlights) *
        0.10;


      // ------------------------------------------------------
      // BLACKS / WHITES
      //
      // Tradotti in level.
      //
      // blacks positivo = neri più sollevati
      // blacks negativo = neri più profondi
      //
      // whites positivo = bianchi più luminosi
      // whites negativo = bianchi più contenuti
      // ------------------------------------------------------

      let blackPoint =
        0;

      let whitePoint =
        100;


      if (blacks < 0) {

        blackPoint =
          Math.abs(blacks) *
          0.10;
      }

      if (blacks > 0) {

        blackPoint =
          -blacks *
          0.05;
      }


      if (whites > 0) {

        whitePoint =
          100 -
          whites * 0.10;
      }

      if (whites < 0) {

        whitePoint =
          100 +
          Math.abs(whites) *
          0.05;
      }


      blackPoint =
        Math.max(
          -3,
          Math.min(
            6,
            blackPoint
          )
        );


      whitePoint =
        Math.max(
          94,
          Math.min(
            103,
            whitePoint
          )
        );


      // ------------------------------------------------------
      // TEMPERATURA
      //
      // Regolazione RGB conservativa.
      // ------------------------------------------------------

      const tempRed =
        100 +
        temperature * 0.25;

      const tempBlue =
        100 -
        temperature * 0.25;


      // ------------------------------------------------------
      // TINT
      //
      // Magenta/verde tramite canale Green.
      //
      // tint positivo = magenta
      // -> riduciamo leggermente il verde.
      //
      // tint negativo = verde
      // -> aumentiamo leggermente il verde.
      // ------------------------------------------------------

      const greenFactor =
        100 -
        tint * 0.18;


      // ------------------------------------------------------
      // VIBRANCE
      //
      // ImageMagick non offre un cursore Lightroom Vibrance
      // identico.
      //
      // Usiamo una saturazione secondaria molto moderata.
      // ------------------------------------------------------

      const vibranceSaturation =
        100 +
        vibrance * 0.40;


      // ======================================================
      // ARGOMENTI IMAGEMAGICK
      // ======================================================

      const args = [

        inputPath,

        "-auto-orient",

        "-colorspace",
        "sRGB"
      ];


      // ======================================================
      // 1. TEMPERATURA
      // ======================================================

      if (temperature !== 0) {

        args.push(
          "-channel",
          "R",
          "-evaluate",
          "multiply",
          String(tempRed / 100),

          "-channel",
          "B",
          "-evaluate",
          "multiply",
          String(tempBlue / 100),

          "+channel"
        );
      }


      // ======================================================
      // 2. TINT
      // ======================================================

      if (tint !== 0) {

        args.push(
          "-channel",
          "G",
          "-evaluate",
          "multiply",
          String(greenFactor / 100),
          "+channel"
        );
      }


      // ======================================================
      // 3. SHADOWS
      // ======================================================

      if (shadows !== 0) {

        if (shadows > 0) {

          // Apri le ombre.
          args.push(
            "+sigmoidal-contrast",
            `${shadowsStrength}x30%`
          );

        } else {

          // Chiudi le ombre.
          args.push(
            "-sigmoidal-contrast",
            `${shadowsStrength}x30%`
          );
        }
      }


      // ======================================================
      // 4. HIGHLIGHTS
      // ======================================================

      if (highlights !== 0) {

        if (highlights < 0) {

          // Recupera / comprime alte luci.
          args.push(
            "+sigmoidal-contrast",
            `${highlightsStrength}x70%`
          );

        } else {

          // Aumenta brillantezza alte luci.
          args.push(
            "-sigmoidal-contrast",
            `${highlightsStrength}x70%`
          );
        }
      }


      // ======================================================
      // 5. WHITES / BLACKS
      // ======================================================

      if (
        whites !== 0 ||
        blacks !== 0
      ) {

        args.push(
          "-level",
          `${blackPoint}%,${whitePoint}%`
        );
      }


      // ======================================================
      // 6. BRIGHTNESS + SATURATION
      // ======================================================

      args.push(
        "-modulate",
        `${brightness},${saturation},100`
      );


      // ======================================================
      // 7. VIBRANCE
      // ======================================================

      if (vibrance !== 0) {

        args.push(
          "-modulate",
          `100,${vibranceSaturation},100`
        );
      }


      // ======================================================
      // 8. GAMMA
      // ======================================================

      if (gamma !== 1) {

        args.push(
          "-gamma",
          String(gamma)
        );
      }


      // ======================================================
      // 9. CONTRASTO
      //
      // Sigmoidal è più fotografico rispetto
      // al contrasto lineare.
      // ======================================================

      if (contrast !== 0) {

        const contrastStrength =
          Math.abs(contrast) *
          0.25;


        if (contrast > 0) {

          args.push(
            "-sigmoidal-contrast",
            `${contrastStrength}x50%`
          );

        } else {

          args.push(
            "+sigmoidal-contrast",
            `${contrastStrength}x50%`
          );
        }
      }


      // ======================================================
      // 10. SHARPEN
      // ======================================================

      if (sharpen > 0) {

        args.push(
          "-unsharp",
          `0x${sharpen}+0.7+0.02`
        );
      }


      // ======================================================
      // 11. JPEG
      // ======================================================

      args.push(
        "-quality",
        String(quality),

        outputPath
      );


      console.log(
        "ImageMagick params:",
        {
          brightness,
          gamma,
          contrast,
          saturation,
          temperature,
          tint,
          shadows,
          highlights,
          whites,
          blacks,
          vibrance,
          sharpen,
          quality
        }
      );


      execFile(
        "convert",
        args,
        {
          maxBuffer:
            20 * 1024 * 1024
        },

        (error, stdout, stderr) => {

          if (error) {

            console.error(
              "ImageMagick error:",
              error
            );

            console.error(
              "ImageMagick stderr:",
              stderr
            );

            reject(
              new Error(
                stderr ||
                error.message
              )
            );

            return;
          }


          resolve();
        }
      );
    }
  );
}


// ============================================================
// DROPBOX UPLOAD
// ============================================================

async function uploadToDropbox(
  accessToken,
  destinationPath,
  outputBuffer
) {

  const response =
    await fetch(
      "https://content.dropboxapi.com/2/files/upload",
      {
        method: "POST",

        headers: {

          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/octet-stream",

          "Dropbox-API-Arg":
            JSON.stringify({

              path:
                destinationPath,

              mode:
                "overwrite",

              autorename:
                false,

              mute:
                true
            })
        },

        body:
          outputBuffer
      }
    );


  const data =
    await response.json();


  if (!response.ok) {

    throw new Error(
      "Dropbox upload error: " +
      JSON.stringify(data)
    );
  }


  return data;
}


// ============================================================
// NORMALIZZA PARAMETRI
// ============================================================

function normalizeValues(body) {

  return {

    brightness:
      clamp(
        body.brightness,
        85,
        120,
        100
      ),

    gamma:
      clamp(
        body.gamma,
        0.75,
        1.25,
        1
      ),

    contrast:
      clamp(
        body.contrast,
        -20,
        20,
        0
      ),

    saturation:
      clamp(
        body.saturation,
        75,
        125,
        100
      ),

    temperature:
      clamp(
        body.temperature,
        -80,
        80,
        0
      ),

    tint:
      clamp(
        body.tint,
        -60,
        60,
        0
      ),

    shadows:
      clamp(
        body.shadows,
        -50,
        50,
        0
      ),

    highlights:
      clamp(
        body.highlights,
        -50,
        50,
        0
      ),

    whites:
      clamp(
        body.whites,
        -30,
        30,
        0
      ),

    blacks:
      clamp(
        body.blacks,
        -30,
        30,
        0
      ),

    vibrance:
      clamp(
        body.vibrance,
        -30,
        30,
        0
      ),

    sharpen:
      clamp(
        body.sharpen,
        0,
        1.5,
        0.3
      ),

    quality:
      clamp(
        body.quality,
        80,
        100,
        95
      )
  };
}


// ============================================================
// VECCHIO ENDPOINT SINCRONO
// Rimane per compatibilità/test.
// ============================================================

app.post(
  "/develop",

  upload.single("image"),

  async (req, res) => {

    let inputPath = null;
    let outputPath = null;


    try {

      if (!req.file) {

        return res.status(400).json({
          ok: false,
          error: "Image missing"
        });
      }


      inputPath =
        req.file.path;


      outputPath =
        path.join(
          os.tmpdir(),
          `${crypto.randomUUID()}.jpg`
        );


      const values =
        normalizeValues(
          req.body
        );


      await developImage(
        inputPath,
        outputPath,
        values
      );


      const stat =
        fs.statSync(
          outputPath
        );


      if (
        stat.size <
        50 * 1024
      ) {

        throw new Error(
          "Output JPEG troppo piccolo."
        );
      }


      res.set(
        "Content-Type",
        "image/jpeg"
      );


      res.set(
        "Content-Length",
        String(stat.size)
      );


      const stream =
        fs.createReadStream(
          outputPath
        );


      stream.pipe(res);


      stream.on(
        "close",
        () => {

          try {
            fs.unlinkSync(
              outputPath
            );
          } catch {}

          try {
            fs.unlinkSync(
              inputPath
            );
          } catch {}
        }
      );


    } catch (error) {

      console.error(
        "SYNC ERROR:",
        error
      );


      try {

        if (
          inputPath &&
          fs.existsSync(inputPath)
        ) {

          fs.unlinkSync(
            inputPath
          );
        }

      } catch {}


      try {

        if (
          outputPath &&
          fs.existsSync(outputPath)
        ) {

          fs.unlinkSync(
            outputPath
          );
        }

      } catch {}


      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);


// ============================================================
// ENDPOINT ASINCRONO
// ============================================================

app.post(
  "/develop-async",

  upload.single("image"),

  async (req, res) => {

    if (!req.file) {

      return res.status(400).json({
        ok: false,
        error: "Image missing"
      });
    }


    const dropboxToken =
      req.body.dropboxToken;


    const destinationPath =
      req.body.destinationPath;


    if (!dropboxToken) {

      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {}


      return res.status(400).json({
        ok: false,
        error: "dropboxToken missing"
      });
    }


    if (!destinationPath) {

      try {
        fs.unlinkSync(
          req.file.path
        );
      } catch {}


      return res.status(400).json({
        ok: false,
        error: "destinationPath missing"
      });
    }


    const jobId =
      crypto.randomUUID();


    const inputPath =
      req.file.path;


    const outputPath =
      path.join(
        os.tmpdir(),
        `${jobId}.jpg`
      );


    const values =
      normalizeValues(
        req.body
      );


    jobs.set(
      jobId,
      {
        ok: true,
        jobId,
        status: "processing",
        destinationPath,
        createdAt:
          new Date().toISOString(),
        values
      }
    );


    // ========================================================
    // RISPONDI SUBITO
    // ========================================================

    res.status(202).json({
      ok: true,
      jobId,
      status: "processing",
      destinationPath
    });


    // ========================================================
    // PROCESSA DOPO LA RISPOSTA
    // ========================================================

    try {

      console.log(
        "START JOB",
        jobId,
        destinationPath
      );


      await developImage(
        inputPath,
        outputPath,
        values
      );


      const stat =
        fs.statSync(
          outputPath
        );


      if (
        stat.size <
        50 * 1024
      ) {

        throw new Error(
          "JPEG finale troppo piccolo: " +
          stat.size +
          " bytes"
        );
      }


      const outputBuffer =
        fs.readFileSync(
          outputPath
        );


      const dropboxResult =
        await uploadToDropbox(
          dropboxToken,
          destinationPath,
          outputBuffer
        );


      jobs.set(
        jobId,
        {
          ok: true,
          jobId,
          status: "completed",
          destinationPath,
          finalSize:
            stat.size,
          dropboxPath:
            dropboxResult.path_display ||
            destinationPath,
          completedAt:
            new Date().toISOString(),
          values
        }
      );


      console.log(
        "JOB COMPLETED",
        jobId,
        stat.size,
        "bytes"
      );


    } catch (error) {

      console.error(
        "ASYNC JOB ERROR",
        jobId,
        error
      );


      jobs.set(
        jobId,
        {
          ok: true,
          jobId,
          status: "error",
          destinationPath,
          error:
            error.message,
          completedAt:
            new Date().toISOString(),
          values
        }
      );


    } finally {


      try {

        if (
          fs.existsSync(
            inputPath
          )
        ) {

          fs.unlinkSync(
            inputPath
          );
        }

      } catch {}


      try {

        if (
          fs.existsSync(
            outputPath
          )
        ) {

          fs.unlinkSync(
            outputPath
          );
        }

      } catch {}
    }
  }
);


// ============================================================
// STATO JOB
// ============================================================

app.get(
  "/job/:id",

  (req, res) => {

    const jobId =
      req.params.id;


    const job =
      jobs.get(
        jobId
      );


    if (!job) {

      return res.status(404).json({
        ok: false,
        error:
          "Job not found"
      });
    }


    res.set(
      "Cache-Control",
      "no-store"
    );


    return res.json(
      job
    );
  }
);


// ============================================================
// AVVIO SERVER
// ============================================================

app.listen(
  PORT,

  () => {

    console.log(
      `ImageMagick service listening on port ${PORT}`
    );
  }
);
