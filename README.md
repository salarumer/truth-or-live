# Truth or Li(v)e

A multiplayer AI-powered lie detection game. Either you tell a story and the AI tries to catch you lying using live video and voice analysis, or the AI tells a story and you try to figure out if it's true or false.

## Running Locally

**Prerequisites:** Node.js 18+

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create a `.env` file** in the project root with your Gemini API key:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
   Get a free API key at [Google AI Studio](https://aistudio.google.com/apikey).

3. **Start the dev server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

> **Note:** The game uses your camera and microphone. Make sure to allow access when prompted.

## Game Modes

- **I Tell a Story** — You tell the AI a true or made-up story. It watches your face and listens to your voice to decide if you're lying.
- **AI Tells a Story** — The AI tells a story about a random topic. You and your friends ask questions and vote on whether it's true or false.

## Deploying to Production

The app runs as an Express server that serves the built React frontend. Set the `GEMINI_API_KEY` environment variable on your hosting platform.

```bash
npm start   # builds the frontend then starts the server on $PORT (default 8080)
```
