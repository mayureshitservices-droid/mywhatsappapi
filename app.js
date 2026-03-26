const dotenv = require("dotenv");
const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser')
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const fileUpload = require("express-fileupload");
const fs = require('fs');
const path = require('path');
const authRoutes = require('./routes/authRoutes');
const { requireAuth, checkUser } = require('./middleware/authMiddleware');
const { Server } = require("socket.io");
const http = require("http");
const User = require('./models/User');
const MessageLog = require('./models/MessageLog');
const axios = require('axios');

dotenv.config();
const sessionMap = new Map();
const alreadyInitialized = new Map();
const currentlyInitializing = new Set();

/* 
const msg = client.getMessageById(messageId);
msg.delete(true);
const isCurrNoIsRegisteredWithWhatsapp = await client.isRegisteredUser(number);

// CLEAR CACHE AND REDUCE MEMORY USAGE
let cachePath = path.join("./.wwebjs_auth/session/Default/Cache")
let cacheFiles = fs.readdirSync(cachePath)
for (let file of cacheFiles){
    fs.rmSync(file)
}



*/



const app = express();
const PORT = process.env.PORT || 8080
const server = http.createServer(app);
const io = new Server(server);

// middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload())// https://sebhastian.com/express-fileupload/
// https://www.npmjs.com/package/express-fileupload

app.set('views', path.join(__dirname, 'views'));
// view engine
app.set('view engine', 'ejs');



// MONGODBURI = "mongodb+srv://mayurbusinesssolutions:ZOIy62RPFja8UAq1@sonisirproject.e53zrib.mongodb.net/whatsappAPI"
mongoose.connect(process.env.MONGODBURI).then(e => {
  server.listen(PORT);
  console.log(`[SERVER] Mongodb connected successfully. Listening on port ${PORT}`);
  initiateAllWhatsappClients()
})
  .catch(error => {
    console.log(error.message)
  });

// Routes
app.get('*', checkUser);
app.get('/', (req, res) => res.render('home'));
app.get('/customerpage', requireAuth, (req, res) => res.render('customerpage'));
app.get('/adminpage', requireAuth, (req, res) =>  res.render('adminpage'));
app.use(authRoutes);



// socket io
io.on("connection", (socket) => {
  console.log(`[SOCKET] New connection established. ID: ${socket.id}`);
  socket.on("generateQrCode", async (customerId) => {
    console.log(`[SOCKET] Requesting QR code for CustomerID: ${customerId}`);
    const folderName = `session-${customerId}`
    // Construct the full path to the folder
    const folderPath = path.join(__dirname, '.wwebjs_auth', folderName);
    // Check if the folder exists before attempting to delete
    // Check if the folder exists before attempting to delete
    const folderExists = await new Promise((resolve) => {
      fs.access(folderPath, (err) => {
        resolve(!err);
      });
    });
    console.log(folderExists);
    if (folderExists) {
      // Delete the folder
      await fs.promises.rm(folderPath, { recursive: true });
      console.log(`Folder '${folderName}' deleted successfully`);
    } else {
      console.log(`Folder '${folderName}' does not exist`);
    }
    console.log('Generate QR code');
    const { client, isNew } = whatsappFactoryFunction(customerId);
    if (!isNew) {
      console.log(`[WHATSAPP] Session for ${customerId} already active. Not attaching new listeners.`);
      return socket.emit('ClientIsAlreadyConnected');
    }

    // Listeners are now attached inside whatsappFactoryFunction
    client.on('qr', (qr) => {
      QRCode.toDataURL(qr, (err, url) => {
        qrCount++;
        console.log("inc: " + qrCount);
        socket.emit('qrCodeGenerated', url);
      });
    });

    client.once('ready', () => {
       socket.emit('ClientIsReady');
    });

    console.log(`[WHATSAPP] Initializing client for ${customerId}...`);
    try {
      await client.initialize();
      console.log(`[WHATSAPP] client.initialize() called for ${customerId}`);
    } catch (err) {
      console.error(`[WHATSAPP] Failed to initialize client for ${customerId}:`, err.message);
      socket.emit('error', 'Failed to start WhatsApp. Please try again.');
    }
  });
});


// Function to create a new WhatsApp client instance
// Function to create a new WhatsApp client instance
function whatsappFactoryFunction(customerId) {
  if (sessionMap.has(customerId)) {
    return { client: sessionMap.get(customerId).client, isNew: false };
  }
  const folderName = `session-${customerId}`;

  const folderPath = path.join(__dirname, '.wwebjs_auth', folderName);
  const lockFile = path.join(folderPath, 'SingletonLock');

  try {
    if (fs.existsSync(lockFile)) {
      console.log(`[WHATSAPP] Removing stale SingletonLock for user ${customerId}`);
      fs.unlinkSync(lockFile);
    }
  } catch (err) {
    console.warn(`[WHATSAPP] Could not remove SingletonLock: ${err.message}`);
  }

  const client = new Client({
    restartOnAuthFail: true,
    qrMaxRetries: 10, // keep it outside of the puppeteer object
    puppeteer: {
      ...(process.env.PUPPETEER_EXECUTABLE_PATH && { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-features=IsolateOrigins,site-per-process',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: customerId,
    }),
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
  });

  // Attach listeners only to the new client
  client.on('qr', (qr) => {
    // console.log(`[WHATSAPP] QR generated for ${customerId}`);
    // This will be handled by the socket if needed
  });

  client.on('authenticated', () => {
    console.log(`[WHATSAPP] Authenticated successfully: ${customerId}`);
  });

  client.on('auth_failure', msg => {
    console.error(`[WHATSAPP] Authentication failure: ${customerId}. Reason: ${msg}`);
  });

  client.on('ready', async () => {
    console.log(`[WHATSAPP] Client READY: ${customerId}`);
    try {
      const user = await User.findById(customerId);
      if (user) {
        const connectedWhatsappNo = client.info.wid.user;
        await User.updateOne({ _id: customerId }, { $set: { connectedWhatsappNo: connectedWhatsappNo } });
        
        sessionMap.set(customerId, { id: customerId, client: client });
        alreadyInitialized.set(connectedWhatsappNo, 'initialized');
        currentlyInitializing.delete(customerId);
      }
    } catch (error) {
      console.error(`[WHATSAPP] Error in ready event for ${customerId}:`, error.message);
    }
  });

  client.on('disconnected', async (reason) => {
    console.warn(`[WHATSAPP] Client DISCONNECTED: ${customerId}. Reason: ${reason}`);
    sessionMap.delete(customerId);
    currentlyInitializing.delete(customerId);
    await User.updateOne({ _id: customerId }, { $set: { connectedWhatsappNo: '0' } });
    
    setTimeout(() => {
        try { client.destroy(); } catch(e) {}
    }, 5000);
  });

  return { client, isNew: true };
}


async function insertClientDetailstoCustDoc(customerId, connectedWhatsappNo) {
  try {
    console.log(customerId);
    const result = await User.updateOne({ _id: customerId }, { $set: { connectedWhatsappNo: connectedWhatsappNo } });
    console.log(result);
  } catch (error) {
    console.log(error.message);
  }
}




app.post('/deleteConnectedwhatsapp', requireAuth, async (req, res) => {
  try {
    let { customerId } = req.body;

    const client = whatsappFactoryFunction(customerId);
    client.on('ready', async () => {
      console.log('ready event is fired');
      const setConnectedWhNumberZero = await User.updateOne({ _id: customerId }, { $set: { connectedWhatsappNo: '0' } });
      console.log(setConnectedWhNumberZero);
      await client.logout();
      await client.destroy();
      console.log('Client logged out');
      const folderName = `session-${customerId}`
      // Construct the full path to the folder
      const folderPath = path.join(__dirname, '.wwebjs_auth', folderName);
      // Check if the folder exists before attempting to delete
      // Check if the folder exists before attempting to delete
      const folderExists = await new Promise((resolve) => {
        fs.access(folderPath, (err) => {
          resolve(!err);
        });
      });
      console.log(folderExists);
      if (folderExists) {
        // Delete the folder
        await fs.promises.rm(folderPath, { recursive: true });
        console.log(`Folder '${folderName}' deleted successfully`);
      } else {
        console.log(`Folder '${folderName}' does not exist`);
      }
      res.status(200).json({ message: 'Connected Whatsapp number set to zero and folder deleted successfully' });
    });
    client.on('auth_failure', msg => {
      // Fired if session restore was unsuccessful
      // delete connected whatsapp number from the document and theauth files
      console.error('AUTHENTICATION FAILURE', msg);
    });
    client.initialize();
    // Send a response to the client

  } catch (error) {
    // Handle errors
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.post('/api/sendmessage', async (req, res) => {
  let { customerId, message, mobileno, messagetype } = req.body;
  console.log(`[API] Received sendmessage request: Customer: ${customerId}, To: ${mobileno}, Type: ${messagetype}`);
  try {
    User.findById(customerId)
      .then(async (user) => {
        if (!user) {
          return res.status(404).json({ error: 'Invalid Customer ID' });
        } else {
          console.log(`User ${user.fullname} is sending message`)
          if (user.AvailableCredits < 1) {
            res.status(500).json({
              status: false,
              response: 'Insufficient Credits: Please Add Credit.'
            })
          } else {
            if (user.connectedWhatsappNo === '0') {
              res.status(500).json({
                status: false,
                response: 'Whatsapp is not connected.'
              })
            } else {

              // const client = whatsappFactoryFunction(customerId);
              let sessionObj = sessionMap.get(customerId);
              if (!sessionObj) {
                return res.status(404).json({
                  status: false,
                  response: 'Session not found for this customer. Please log in to WhatsApp via the dashboard first.'
                });
              }
              const client = sessionObj.client;
              if (messagetype === 'text') {
                await client.sendMessage(`${mobileno}@c.us`, message).then(async (response) => {
                  await User.updateOne({ _id: customerId }, { $inc: { AvailableCredits: -1 } });
                  let customerName = user.fullname;
                  let messageId = response._data.id._serialized;
                  MessageLog.create({ custName: customerName, custId: customerId, sentTo: mobileno, content: message, media: 0, messageId: messageId, status: 'sent' })
                  res.status(200).json({
                    status: true,
                    response: 'Message sent successfully',
                    messageId: messageId
                  });
                });
              } else if (messagetype === 'file') {
                let mimeType = req.files.file.mimetype;
                let file = req.files.file;
                let fileName = req.files.file.name;
                console.log(fileName);
                // Check if the file format is supported
                const supportedFormats = ['jpeg', 'jpg', 'png', 'gif', 'pdf', 'xls', 'xlsx', 'mp4', 'mkv', 'avi', 'mov', '3gp'];
                const fileFormat = fileName.split('.').pop().toLowerCase();
                if (!supportedFormats.includes(fileFormat)) {
                  return res.status(400).json({ error: 'Unsupported file format' });
                }
                const filePath = await manageUploadedFile('create', file);
                console.log('filepath is ' + filePath);
                const media = MessageMedia.fromFilePath(filePath);
                console.log('media is ' + media);
                await client.sendMessage(`${mobileno}@c.us`, media, { caption: message }).then(async (response) => {
                  await User.updateOne({ _id: customerId }, { $inc: { AvailableCredits: -1 } });
                  let customerName = user.fullname;
                  let messageId = response._data.id._serialized;
                  MessageLog.create({ custName: customerName, custId: customerId, sentTo: mobileno, content: message, media: true, messageId: messageId, status: 'sent' })
                  await manageUploadedFile('delete', file);
                  res.status(200).json({
                    status: true,
                    response: 'Message sent successfully',
                    messageId: messageId
                  })
                });
              }
            }
          }
        }
      });
  } catch (error) {
    console.error(`[API ERROR] sendmessage failed: ${error.message}`, error);
    if (error.message.includes('Cast to ObjectId')) {
      return res.status(404).json({ error: 'Invalid Customer ID' });
    } else {
      res.status(500).json({ status: false, response: error.message });
    }
  }
});





async function initiateAllWhatsappClients() {
  console.log('Initiating all WhatsApp clients...');
  
  try {
    // get all the whatapp clients
    const users = await User.find({ connectedWhatsappNo: { $ne: '0' } });

    for (const user of users) {
      const waNo = user.connectedWhatsappNo;
      const customerId = user._id.toString();

      if (waNo !== '0' && !alreadyInitialized.has(waNo) && !currentlyInitializing.has(customerId)) {
        const { client, isNew } = whatsappFactoryFunction(user._id);
        if (!isNew) {
           console.log(`[STARTUP] Skipping ${user.fullname}, session already in map.`);
           continue;
        }
        console.log(`[STARTUP] Starting initialization for user: ${user.fullname} (${waNo})`);
        
        currentlyInitializing.add(customerId);
        
        try {
          await client.initialize();
        } catch (initErr) {
          console.error(`[ERROR] Failed to initialize client for ${user.fullname}:`, initErr.message);
          currentlyInitializing.delete(customerId);
        }
      }
    }
  } catch (error) {
    console.error('Error initiating WhatsApp clients:', error.message);
  }
}








app.get('/automation/missedcallalert/*', async (req, res) => {
  console.log('missedcallalert fired');
  const phoneNumber = req.url.replace('/automation/missedcallalert/', '');
  const phoneWithoutSymbol = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  console.log(phoneWithoutSymbol);
  try {
  const id = '65a240c736cdb43ef50854ca';
  const clientObj = sessionMap.get(id);
  const client = clientObj.client;
    const state = await client.getState();
    let message = ''
    message += 'Dear Sir, ' + '\n' + '\n';
    message += 'Thank you for calling our *Relationship Manager. Shreedhar*' +  '\n' + '\n';
    message += 'We apologize that he missed your call; he must be busy attending to valued customers, just like you.' + '\n' + '\n';
    message += 'Rest assured, our Relationship Manager will call you back within a short period of time.' + '\n' + '\n';
    message += 'Senior Relationship Manager : *Mr. Sudhir Meghache : 91 78878 92244*' + '\n' + '\n';
    if (state === 'CONNECTED') {
      await client.sendMessage(`${phoneWithoutSymbol}@c.us`, message).then(async (response) => {
      }).catch(err => {
        console.log(err);
      });
    }
  } catch (error) {
    console.log(error.message);
  }
});




app.post('/api/getmessagestatus', async (req, res) => {
  let { customerId, messageId } = req.body;
  await User.findById(customerId)
    .then(async (user) => {
      await MessageLog.findOne({ messageId: messageId }).then((msg) => {
        let status = msg.status;
        res.status(200).json({ status: status });
      });
    }).catch((error) => {
      console.log(error);
      res.status(500).json({ error: 'Couldnt find the message with id ' + messageId });
    });
});


// ---------------------------------HELPER FUNCTIONS --------------------------------


// WINDOWS COMPATIBLE

function manageUploadedFile(action, file) {
  return new Promise((resolve, reject) => {
    try {
      if (action === 'create') {
        const filePath = path.join(__dirname, 'tmp', file.name);

        file.mv(filePath, (err) => {
          if (err) {
            console.error(err);
            reject(err); // Reject the promise on failure
          } else {
            resolve(filePath); // Resolve the promise with the file path on success
          }
        });
      } else if (action === 'delete') {
        const filePath = path.join(__dirname, 'tmp', file.name);

        fs.unlink(filePath, (err) => {
          if (err) {
            console.error(err);
            reject(err); // Reject the promise on failure
          } else {
            resolve(true); // Resolve the promise with true on success
          }
        });
      } else {
        const errorMessage = 'Invalid action';
        console.error(errorMessage);
        reject(new Error(errorMessage)); // Reject the promise with an error for invalid action
      }
    } catch (error) {
      reject(error); // Reject the promise on any other unexpected error
    }
  });
}

