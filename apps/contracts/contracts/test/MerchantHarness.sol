// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
import {QIEInvoicePayments} from "../QIEInvoicePayments.sol";

/// @dev Local adversarial test fixture, not part of the application deployment.
contract MerchantHarness {
    QIEInvoicePayments public immutable payments;
    bool public rejectPayment;
    bool public attemptReentry;
    bool public propagateFailure;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    bool public sawPaid;
    address public observedPayer;
    uint256 public observedPaidAt;
    bytes32 public activeId;
    bytes32 public targetId;

    constructor(QIEInvoicePayments target) { payments = target; }
    function create(bytes32 id, uint256 amount, uint256 expiry) external {
        payments.createInvoice(id, address(this), amount, expiry);
    }
    function configure(bytes32 id, bytes32 reentryTarget, bool reject, bool reenter, bool propagate) external {
        activeId = id; targetId = reentryTarget;
        rejectPayment = reject; attemptReentry = reenter; propagateFailure = propagate;
    }
    receive() external payable {
        require(!rejectPayment, "Merchant rejects settlement");
        QIEInvoicePayments.Invoice memory invoice = payments.getInvoice(activeId);
        sawPaid = invoice.status == QIEInvoicePayments.Status.Paid;
        observedPayer = invoice.payer;
        observedPaidAt = invoice.paidAt;
        if (attemptReentry) {
            (bool ok, bytes memory data) = address(payments).call{value: msg.value}(
                abi.encodeCall(payments.payInvoice, (targetId))
            );
            reentrySucceeded = ok;
            if (data.length >= 4) reentryError = bytes4(data);
            if (propagateFailure) require(ok, "Propagate rejected reentry");
        }
    }
}
