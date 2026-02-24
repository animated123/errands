import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { firebaseService } from './services/firebaseService';
import { ErrandStatus } from './types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  
  // Google Cloud Run injects PORT. Defaulting to 3000 for AI Studio preview.
  const PORT = Number(process.env.PORT) || 8080;

  app.use(express.json());

  // API routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Detect production mode based on NODE_ENV or existence of dist folder
  const isProduction = process.env.NODE_ENV === 'production' || 
                      (typeof process.env.NODE_ENV === 'undefined' && 
                       fs.existsSync(path.join(__dirname, 'dist')));

  let viteMounted = false;
  // Vite middleware for development
  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
      viteMounted = true;
    } catch (e) {
      console.warn("Vite not found, falling back to static serving if dist exists");
    }
  } 
  
  if (isProduction || !viteMounted) {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    
    // FIX: Express 5 requires a named parameter for wildcards
    // Using {*path} to capture all routes for SPA navigation
    app.get('/*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Function to cancel stale errands
  const cancelStaleErrands = async () => {
    console.log('Checking for stale errands...');
    try {
      const now = Date.now();
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      const staleErrands = await firebaseService.fetchStaleErrands(twentyFourHoursAgo);

      for (const errand of staleErrands) {
        if (errand.status === ErrandStatus.PENDING) {
            await firebaseService.cancelErrand(errand.id);
            console.log(`Cancelled errand ${errand.id}`);
        }
      }
    } catch (error) {
      // Don't let a firebase error crash the whole server startup
      console.error('Firebase sync error:', error.message);
    }
  };

  // Run the check every hour
  setInterval(cancelStaleErrands, 60 * 60 * 1000);
  
  // We wrap this to ensure the server starts listening even if Firebase check fails
  cancelStaleErrands().catch(err => console.error("Initial stale check failed", err));

  // Must listen on 0.0.0.0 for Cloud Run
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical Server Failure:", err);
  process.exit(1);
});