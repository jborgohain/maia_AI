import { Buffer } from 'buffer'
import OpenAI from 'openai'

const openai = new OpenAI({
  organization: process.env.VITE_ORG_ID,
  project: process.env.VITE_PROJECT_ID,
  apiKey: process.env.VITE_OPENAI_API_KEY
})

const MAX_FILE_SIZE = 2 * 1024 * 1024 // Example: 2MB size limit

const parseMultipartForm = (event) => {
  const boundary = event.headers['content-type'].split('boundary=')[1]
  let result = { file: null, chatHistory: null }
  try {
    const parts = Buffer.from(event.body, 'base64').toString().split(`--${boundary}`)

    parts.forEach((part) => {
      if (part.includes('filename=')) {
        const filenameMatch = part.match(/filename="(.+)"/)
        if (filenameMatch) {
          const filename = filenameMatch[1]
          const content = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim()

          // Check file size during parsing
          const fileSize = Buffer.byteLength(content, 'utf8')
          if (fileSize > MAX_FILE_SIZE) {
            throw new Error(`File size exceeds the allowed limit of ${MAX_FILE_SIZE} bytes`)
          }

          result.file = { filename, content }
        }
      } else if (part.includes('name="chatHistory"')) {
        const content = part.split('\r\n\r\n')[1].trim()
        result.chatHistory = JSON.parse(content)
      }
    })
  } catch (error) {
    throw new Error('Error parsing multipart form: ' + error.message)
  }
  return result
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  if (
    event.headers['content-type'] &&
    event.headers['content-type'].includes('multipart/form-data')
  ) {
    // Check content-length header before parsing
    const fileSize = parseInt(event.headers['content-length'], 10)
    if (fileSize > MAX_FILE_SIZE) {
      return {
        statusCode: 413,
        body: JSON.stringify({ message: 'File size exceeds the allowed limit of 2MB' })
      }
    }

    try {
      const formData = parseMultipartForm(event)

      if (!formData || !formData.file) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: 'No file found in form data' })
        }
      }

      const updatedChatHistory = formData.chatHistory || []
      const newItem = {
        role: 'system',
        content: `{ "type":"file", "filename":"${formData.file.filename}", "size":"${fileSize} bytes"}\n${formData.file.content}`
      }
      if (!updatedChatHistory.includes(newItem)) {
        updatedChatHistory.push(newItem)
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Markdown file processed successfully',
          chatHistory: updatedChatHistory
        })
      }
    } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: `Server error: ${error.message}` })
      }
    }
  } else {
    // Handle other POST requests (e.g., chat completions)
    try {
      let { chatHistory, newValue } = JSON.parse(event.body)
      chatHistory.push({
        role: 'user',
        content: newValue
      })
      const params = {
        messages: chatHistory,
        model: 'gpt-3.5-turbo'
      }

      const response = await openai.chat.completions.create(params)
      chatHistory.push(response.choices[0].message)

      return {
        statusCode: 200,
        body: JSON.stringify(chatHistory)
      }
    } catch (error) {
      let chatHistory = JSON.parse(event.body)
      chatHistory.push({
        role: 'assistant',
        content: 'Assistant timed out. Consider breaking up your prompt into smaller pieces.'
      })
      return {
        statusCode: 200,
        body: JSON.stringify(chatHistory)
      }
    }
  }
}

export { handler }
