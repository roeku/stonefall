import { Devvit } from '@devvit/public-api';

// Configure Devvit with required capabilities
Devvit.configure({
  redditAPI: true,
  redis: true,
  http: true,
});

// Export the configured Devvit instance
export default Devvit;
