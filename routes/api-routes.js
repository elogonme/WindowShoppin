// Requiring our models and passport as we've configured it
let db = require("../models");
let passport = require("../config/passport");
let scrapeItem = require("../controllers/scraper");
const item = require("../models/item");
const { response } = require("express");
const getCurrencies = require("../controllers/currenciesController");
const moment = require('moment'); // require
let lastUpdate;
let selectCur = {};

// Helper function to get currencies
const fetchCurrencies = () => {
  getCurrencies((result) => {
    lastUpdate = result;
    result = result.conversion_rates
    // Select only some curencies
    for( key in result){
      if (key === 'USD' || key === 'CAD' || key === 'EUR' || key === 'GBP' || key === 'RUB' || key === 'JPY' || key === 'CNY' || key === 'AUD'){
        selectCur[key] = result[key]
      }
    }
  });
};

// Fetch currencies on first run
fetchCurrencies();

module.exports = function(app) {
  // Using the passport.authenticate middleware with our local strategy.
  // If the user has valid login credentials, send them to the members page.
  // Otherwise the user will be sent an error
  app.post("/api/login", passport.authenticate("local"), function(req, res) {
    res.json(req.user);
  });

  // Route for signing up a user. The user's password is automatically hashed and stored securely
  // Sequelize User Model is configured. If the user is created successfully, proceed to log the user in,
  // otherwise send back an error
  app.post("/api/signup", function(req, res) {
    db.User.create({
      email: req.body.email,
      password: req.body.password
    })
      .then(function() {
        res.redirect(307, "/api/login");
      })
      .catch(function(err) {
        res.status(401).json({err});
      });
  });

  // Route for logging user out
  app.get("/logout", function(req, res) {
    console.log('User logged out... Bye!');
    req.logout();
    res.redirect("/");
  });

  // Route for getting some data about our user to be used client side
  app.get("/api/user_data", function(req, res) {
    if (!req.user) {
      // The user is not logged in, send back an empty object
      res.json({msg: 'User is not logged in!'});
    } else {
      // Otherwise send back the user's email and id
      // Sending back a password, even a hashed password, isn't a good idea
      res.json({
        email: req.user.email,
        id: req.user.id
      });
    }
  });

  // API to get update on currency rates from exchangerate-api
  app.get("/api/currencies", function(req, res) {
    if (!req.user) {
      // The user is not logged in, send back an empty object
      res.json({msg: 'User is not logged in!'});
    } else {
        // If update is not old do not call API again
        if(!lastUpdate || lastUpdate.time_last_update_utc.slice(0, 16) !== moment().format('ddd, DD MMM YYYY')){
          // Otherwise get and send back the select currencies
          console.log('updating curencies');
          fetchCurrencies();
        } 
        res.json(selectCur);
    }
  });

  // API Route for getting all the items of user and send back as JSON 
  app.get("/api/items", (req,res) => {
    if (!req.user) {
      // The user is not logged in, send back message
        res.json({msg: 'User is not logged in!'});
      } else {
      db.Item.findAll({where: { UserId: req.user.id }}).then((results) => {
        res.json(results);
      }).catch(function(err) {
        res.status(401).json({err});
      });
    };
  });

  // Route for finding one single item
  app.get("/api/items/:id", (req,res) => {
    if (!req.user) {
      // The user is not logged in, send back message
      res.json({msg: 'User is not logged in!'});
    } else {
      db.Item.findOne({
        where: {
          UserId: req.user.id,
          id: req.params.id
        }
      }).then((results) => {
        const hbsItemObject = {
          items: results
        }
        // send rendered page to view single item
        res.render("viewitem", hbsItemObject)
      });
    };
  });

  // Route for deleting item from DB
  app.delete('/api/items/:id', (req, res) => {
    if (!req.user) {
      // The user is not logged in, send back an empty object
      res.json({msg: 'User is not logged in!'});
    } else {
      db.Item.destroy({
        where: {
          UserId: req.user.id,
          id: req.params.id
        },
      }).then((dbPost) => res.json(dbPost))
      .catch(function(err) {
        res.status(401).json({err});
      });
    };
  });

  // Route for adding in a note
  app.put('/api/items/:id', (req, res) => {
    if (!req.user) {
      // The user is not logged in, send back an empty object
      res.json({msg: 'User is not logged in!'});
    } else {
      db.Item.update(req.body, {
        where: {
          UserId: req.user.id,
          id: req.params.id,
        }
      })
      .then((dbPost) => res.json(dbPost))
      .catch(function(err) {
        res.status(401).json({err});
      });
    };
  })

  // Route for scraping item data from url
  app.post("/api/scrape", (req, res) => {
    if (req.user) {
      if (req.body.url) {
        // scraperController(req.body.url, (data) => {
        scrapeItem(req.body.url, (data) => {
          // save to db and return
          if (data.title) {
            data.UserId = req.user.id;
            db.Item.create(data, { logging: false }).then(() => {
              console.log('created item: ', data.title);
              res.status(201).json(data);
            });
          } else {
            res.status(404).send('Unable to get item data');
          }
        });
      } else {
        res.status(404).end();
      }
    } else {
      res.status(401).json({msg: 'User is not logged in!'}); // Return not authorized if no user credentials
    }
  });

  // Route for re-scraping item data from url based on id saved in DB to see if price is updated.
  app.post("/api/scrape/:id", (req, res) => {
    if (req.user) {
      db.Item.findOne({
        where: {
          id: req.params.id
        }
      }).then(item => {
        // scrape again for item with id
        console.log('checkng update for item id: ', item.id);
        scrapeItem(item.url, (data) => {
          // check if price changed and save to db
          console.log('compare: ', Number(item.initialPrice), data.initialPrice);
          // Check if initial or new saved price is updated
          if (data.initialPrice !== Number(item.initialPrice) && data.initialPrice !== Number(item.newPrice)) {
            item.newPrice = data.initialPrice;
            item.isUpdated = true;
            console.log('there is an update!')
            db.Item.update({ newPrice: item.newPrice, isUpdated: true }, {
              where: {
                id: item.id,
              },
            }).then((result) => {
              console.log('updated item: ', result);
              res.status(200).send('updated item!');
            });
          } else {
            console.log('no update!');
            db.Item.update({ isUpdated: false }, {
              where: {
                id: item.id,
              }
            });
            res.status(200).send('no update');
          }
        });
      }). catch (err => {
        console.log('Error, item is not found');
        res.status(404).send('Item is not found');
      });
    } else {
      res.status(401).end(); // Return not authorized if no user credentials
    }
  });
};
