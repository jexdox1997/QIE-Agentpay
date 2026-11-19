// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Immutable invoice registry with atomic native-QIE settlement.
/// @dev No owner, custody account, upgrade mechanism or withdrawal function.
contract QIEInvoicePayments is ReentrancyGuard {
    enum Status { None, Unpaid, Paid, Expired }

    struct Invoice {
        bytes32 invoiceId;
        address merchant;
        uint256 amountWei;
        uint256 expiresAt;
        address payer;
        uint256 paidAt;
        Status status;
    }

    mapping(bytes32 => Invoice) private invoices;

    error InvalidInvoiceId();
    error InvalidMerchant();
    error UnauthorizedMerchant();
    error InvalidAmount();
    error InvalidExpiration();
    error InvoiceAlreadyExists(bytes32 invoiceId);
    error InvoiceNotFound(bytes32 invoiceId);
    error InvoiceAlreadyPaid(bytes32 invoiceId);
    error InvoiceExpired(bytes32 invoiceId);
    error IncorrectPayment(uint256 expected, uint256 received);
    error SettlementFailed(bytes32 invoiceId);

    event InvoiceCreated(bytes32 indexed invoiceId, address indexed merchant,
        uint256 amountWei, uint256 expiresAt, uint256 createdAt);
    event InvoicePaid(bytes32 indexed invoiceId, address indexed merchant, address indexed payer,
        uint256 amountWei, uint256 paidAt);

    /// @notice Explicit merchant must equal msg.sender; no creation on another wallet's behalf.
    function createInvoice(bytes32 invoiceId, address merchant, uint256 amountWei, uint256 expiresAt)
        external nonReentrant
    {
        if (invoiceId == bytes32(0)) revert InvalidInvoiceId();
        if (merchant == address(0)) revert InvalidMerchant();
        if (merchant != msg.sender) revert UnauthorizedMerchant();
        if (invoices[invoiceId].status != Status.None) revert InvoiceAlreadyExists(invoiceId);
        if (amountWei == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiration();

        invoices[invoiceId] = Invoice(invoiceId, merchant, amountWei, expiresAt, address(0), 0, Status.Unpaid);
        emit InvoiceCreated(invoiceId, merchant, amountWei, expiresAt, block.timestamp);
    }

    /// @notice Anyone can settle with exactly the requested native-QIE amount.
    function payInvoice(bytes32 invoiceId) external payable nonReentrant {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == Status.None) revert InvoiceNotFound(invoiceId);
        if (invoice.status == Status.Paid) revert InvoiceAlreadyPaid(invoiceId);
        if (block.timestamp >= invoice.expiresAt) revert InvoiceExpired(invoiceId);
        if (msg.value != invoice.amountWei) revert IncorrectPayment(invoice.amountWei, msg.value);

        // Effects precede every external interaction, including merchant callback reads.
        invoice.status = Status.Paid;
        invoice.payer = msg.sender;
        invoice.paidAt = block.timestamp;
        emit InvoicePaid(invoiceId, invoice.merchant, msg.sender, invoice.amountWei, block.timestamp);

        (bool settled,) = payable(invoice.merchant).call{value: msg.value}("");
        if (!settled) revert SettlementFailed(invoiceId);
    }

    /// @notice Missing IDs revert; expiration is computed without a maintenance transaction.
    function getInvoice(bytes32 invoiceId) external view returns (Invoice memory invoice) {
        invoice = invoices[invoiceId];
        if (invoice.status == Status.None) revert InvoiceNotFound(invoiceId);
        invoice.status = getInvoiceStatus(invoiceId);
    }

    /// @notice Missing IDs return None. Paid takes precedence over expiration.
    function getInvoiceStatus(bytes32 invoiceId) public view returns (Status) {
        Invoice storage invoice = invoices[invoiceId];
        if (invoice.status == Status.Unpaid && block.timestamp >= invoice.expiresAt) return Status.Expired;
        return invoice.status;
    }
}
