'use strict'
const {BaseKonnector, log, requestFactory, updateOrCreate} = require('cozy-konnector-libs')
const connection = require('./connection')
const bluebird = require('bluebird')

const baseUrl = `https://espace-client.lanef.com/templates`
module.export = new BaseKonnector(start)

const rq = requestFactory({
  jar: true,
  json: false,
  cheerio: true
})

function start (fields) {
  return login(fields)
  .then(parseAccounts)
  .then(fetchIBANs)
  .then(saveAccounts)
  .then(comptes =>
    bluebird.each(comptes, compte => {
      return fetchOperations(compte)
        .then(operations => saveOperations(compte, operations))
    })
  )
  .then(getDocuments)
}

function nop () {
  console.log('nop')
  return Promise.resolve([true])
}

const fetchOperations = nop
const saveOperations = nop
const getDocuments = nop

function validateLogin (statusCode, $, json) {
  return $('#welcomebar').length === 1
}

function login (fields) {
  log('info', 'Logging in')
  const page = 'logon.cfm'
  const population = {
    'USERID': fields.login,
    'STATIC': fields.password
  }
  return connection.init(`${baseUrl}/logon`, page, '#formSignon', population, validateLogin)
}

function parseAccounts () {
  log('info', 'Gettings accounts')

  return rq(`${baseUrl}/landingPage/accountListWidget.cfm`)
  .then($ => {
    const accounts = Array.from($('#accountList li'))
      .map(item => {
        // NOTE It is possible that the user has given their account a pseudo
        const label = $(item).children('div').eq(0).text().trim()
        return {
          label: label,
          balance: parseAmount($(item).find('.pc-formatted-amount-value').text()),
          type: ( label.match(/Parts Sociales/) ? 'liability' : 'bank' ),
          number: $(item).attr('data-value')
        }
      })

    return Promise.resolve(accounts.map(account => {
      return {
        institutionLabel: 'La Nef',
        ...account
      }
    }))
  })
}

function fetchIBANs (accounts) {
  log('info', 'Fetching IBANs')

  const params = {
    accType: 'IBAN',
    currencyCode: 'EUR',
    page: '1',
    viewMode: 'GRID'
  }

  return Promise.all(
    accounts.map(account => {
      if (account.type !== 'bank') {
        // Only bank accounts can have an IBAN
        return Promise.resolve(account)
      } else {
        return rq({
          uri: `${baseUrl}/account/IBANDetail.cfm`,
          method: 'POST',
          form: {
            AccNum: account.number,
            ...params
          }
        }).then($ => {
          const iban = $('.row').eq(12).children('div').eq(1).text().trim()
          return Promise.resolve({
            iban: iban,
            ...account
          })
        })
      }
    })
  ).then((accounts) => {
    return Promise.resolve(accounts)
  })
}

function parseAmount (amount) {
  return parseFloat(amount.trim().replace('\xa0', '').replace(',', '.'))
}

function saveAccounts (accounts) {
  return updateOrCreate(accounts, 'io.cozy.bank.accounts', ['institutionLabel', 'number'])
}
