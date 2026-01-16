# Use Node.js 20 as the base image
FROM node:20-slim

# Set the working directory
WORKDIR /app

# Copy the entire project context
COPY . .

# Move into the web application directory
WORKDIR /app/asc-converter-web

# Install dependencies
RUN npm install

# Build the Next.js application
RUN npm run build

# Set the environment to production
ENV NODE_ENV production

# Railway automatically provides a PORT environment variable
# Next.js will use it if it's set
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
