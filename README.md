# Editorial Asset Creator

A web application that transforms product page URLs into stunning commercial advertising content using AI.

## Features

- **Product Page Scraping**: Extract product information (name, description, images) from any e-commerce URL
- **AI Design Brief Generation**: Use OpenAI GPT-4 to create editorial design briefs with visual style, messaging, and color recommendations
- **AI Image Generation**: Generate high-quality editorial images using Google Vertex AI
- **Text Overlays**: Automatically add product name and call-to-action text to generated images
- **Download & Export**: Download individual assets or batch download all generated content

## Tech Stack

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI Services**: OpenAI GPT-4, Google Vertex AI (Imagen)
- **Web Scraping**: Cheerio

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- OpenAI API key
- Google Cloud account with Vertex AI enabled

### Installation

1. Clone the repository:
   ```bash
   cd editorial-asset-creator
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Edit `.env.local` with your API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key
   GOOGLE_CLOUD_PROJECT=your_gcp_project_id
   GOOGLE_CLOUD_REGION=us-central1
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
   ```

5. Run the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── generate/        # POST /api/generate
│   │   │   ├── status/          # GET /api/status/:jobId
│   │   │   └── download/        # GET /api/download/:assetId
│   │   ├── page.tsx             # Main application page
│   │   ├── layout.tsx           # Root layout
│   │   └── globals.css          # Global styles
│   ├── components/
│   │   ├── InputSection.tsx     # URL input form
│   │   ├── OutputSection.tsx    # Generated assets display
│   │   ├── DesignBriefDisplay.tsx # Design brief viewer
│   │   └── ProgressIndicator.tsx # Progress tracking
│   ├── services/
│   │   ├── WebScraperService.ts # Product page scraping
│   │   ├── LLMService.ts        # OpenAI integration
│   │   ├── ImageGenerationService.ts # Vertex AI integration
│   │   └── StorageService.ts    # Asset storage management
│   └── types/
│       ├── index.ts             # Core type definitions
│       └── api.ts               # API request/response types
├── public/
│   └── generated/               # Generated assets directory
├── .env.example                 # Environment template
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

## API Endpoints

### POST /api/generate
Initiates the asset generation pipeline.

**Request:**
```json
{
  "productUrl": "https://example.com/product",
  "options": {
    "includeVideo": false,
    "imageCount": 1
  }
}
```

**Response:**
```json
{
  "jobId": "uuid",
  "status": "pending"
}
```

### GET /api/status/:jobId
Returns the current status of a generation job.

**Response:**
```json
{
  "jobId": "uuid",
  "status": "completed",
  "progress": 100,
  "currentStep": "Complete",
  "designBrief": { ... },
  "assets": [ ... ]
}
```

### GET /api/download/:assetId
Downloads a generated asset.

## Configuration

### OpenAI Setup
1. Create an account at [OpenAI](https://platform.openai.com/)
2. Generate an API key
3. Add it to your `.env.local` file

### Google Cloud / Vertex AI Setup
1. Create a Google Cloud project
2. Enable the Vertex AI API
3. Create a service account with Vertex AI permissions
4. Download the service account JSON key
5. Set the `GOOGLE_APPLICATION_CREDENTIALS` path in `.env.local`

## Development

```bash
# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Run linting
npm run lint
```

## Troubleshooting

### Common Issues

1. **"Invalid OpenAI API key"**: Check that your API key is correctly set in `.env.local`

2. **"Failed to scrape product page"**: Some websites block automated requests. Try a different product URL.

3. **"Image generation failed"**: Ensure your Google Cloud credentials are correct and Vertex AI is enabled.

4. **CORS errors**: Make sure you're running the app through the Next.js dev server, not opening HTML files directly.

## License

MIT
