const User = require("../models/User");
const jwt = require("jsonwebtoken");

// handle errors
const handleErrors = (err) => {
    console.log(err.message, err.code);
    let errors = { email: '', password: '' };

    // incorrect email
    if (err.message === 'incorrect email') {
        errors.email = 'That email is not registered';
    }

    // incorrect password
    if (err.message === 'incorrect password') {
        errors.password = 'XXXX password is incorrect';
    }

    // duplicate email error
    if (err.code === 11000) {
        errors.email = 'that email is already registered';
        return errors;
    }

    // validation errors
    if (err.message.includes('user validation failed')) {
        Object.values(err.errors).forEach(({ properties }) => {
            errors[properties.path] = properties.message;
        });
    }

    return errors;

}

const maxAge = 3 * 24 * 60 * 60;
const createToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: maxAge
    });

}


module.exports.signup_get = (req, res) => {
    res.render("signup");
};

module.exports.login_get = (req, res) => {
    res.render("login");
};

module.exports.adminpage_get = (req, res) => {
    res.render("adminpage");
};

module.exports.customerpage_get = (req, res) => {
    res.render("customerpage");
};

module.exports.home_get = (req, res) => {
    res.render("home");
};

module.exports.signup_post = async (req, res) => {
    const { fullname, email, password } = req.body;
    try {
        const user = await User.create({ fullname, email, password });
        // const token = createToken(user._id);
        // res.cookie('jwt', token, { httpOnly: true, maxAge: maxAge * 1000 });
        res.status(201).json({user: user._id});
    } catch (error) {
        const errors = handleErrors(error);
        console.log(error.message);
        res.status(400).json({ errors });
    }
};

module.exports.login_post = async (req, res) => {
    const { email, password } = req.body;
    
    try {
        console.log(`[AUTH] Login attempt for: ${email}`);
        const user = await User.login(email, password);
        console.log(`[AUTH] Login success for user: ${email}`);
        const token = createToken(user._id);
        res.cookie('jwt', token, { httpOnly: true, maxAge: maxAge * 1000 });
        res.status(200).json({ user: user._id, email: user.email });
    } catch (error) {
        const errors = handleErrors(error);
        console.log(error.message);
        res.status(400).json({ errors });
    }
};

module.exports.logout_get = (req, res) => {
    res.cookie('jwt', '', { maxAge: 1 });
    res.redirect('/home'); 
}


module.exports.issuecreditsendpoint_post = async (req, res) => {
    let { customerid, credits } = req.body;
    try {
            const updatedCredits = await User.updateOne({ _id: customerid }, { $inc: { AvailableCredits: credits } });
            res.status(200).json(updatedCredits);
    } catch (error) {
        res.status(400).json(error.message);
    }
};


module.exports.deletecustomer_post = async (req, res) => {
    let { customerId } = req.body;
    const docID = customerId['0'];
try {
    const deletedCustomer = await User.findByIdAndDelete(docID);
    if (deletedCustomer) {
      console.log('Deleted Customer:', deletedCustomer);
      res.json({ message: 'Customer deleted successfully' });
    } else {
      console.log('Customer not found.');
      res.json({ message: 'Customer not found' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'An error occurred while deleting the document' });
  }
};



module.exports.setwebhook_post = async (req, res) => {
    let { customerId, webhookURL } = req.body;
    const docID = customerId['0'];
    try {
        console.log(docID);
        console.log(webhookURL);
            const updatedWebhookURL  = await User.updateOne({ _id: docID }, { $set: { webHookUrl: webhookURL } } );
            res.status(200).json(updatedWebhookURL);
    } catch (error) {
        console.log(error);
        res.status(400).json(error.message);
    }
};



