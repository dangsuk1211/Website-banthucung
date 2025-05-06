const router = require('express').Router();
const BcryptJs    = require('bcryptjs');
const Passport    = require('../modules/passport');
const UserModel   = require('../models/user');
const UserRole    = require('../constants/user-role');

// Hiển thị form đăng nhập
router.get('/dang-nhap.html', (req, res) => {
  const model = { callbackUrl: '/dang-nhap.html' };
  if (req.query.returnUrl) {
    model.callbackUrl = `/dang-nhap.html?returnUrl=${encodeURIComponent(req.query.returnUrl)}`;
  }
  res.render('site/login', model);
});

// Xử lý đăng nhập
router.post('/dang-nhap.html',
  Passport.auth(),
  (req, res) => {
    // Lưu thông tin user do Passport gán vào session để sau này dùng
    req.session.user = req.user;

    // Chuyển hướng về returnUrl nếu có, ngược lại về /
    const returnUrl = req.query.returnUrl ? decodeURIComponent(req.query.returnUrl) : '/';
    res.redirect(returnUrl);
  }
);

// Đăng xuất
router.get('/dang-xuat.html', (req, res) => {
  req.logout();
  // Xóa luôn thông tin user đã lưu trong session
  req.session.user = null;
  res.redirect('/dang-nhap.html');
});

// Hiển thị form đăng ký
router.get('/dang-ky.html', (req, res) => {
  res.render('site/register', {
    isAuthenticated: req.isAuthenticated(),
    errors: null
  });
});

// Xử lý đăng ký
router.post('/dang-ky.html', async (req, res) => {
  const respData = {
    isSucceed: false,
    errors: null,
    message: 'Thất bại'
  };

  // Validation
  req.checkBody('fullname', 'Họ tên không được rỗng.').notEmpty();
  req.checkBody('fullname', 'Họ tên từ 6 đến 30 ký tự.').isLength({ min: 6, max: 30 });
  req.checkBody('email', 'Email không được rỗng.').notEmpty();
  req.checkBody('email', 'Định dạng Email không hợp lệ.').isEmail();
  req.checkBody('password', 'Mật khẩu không được rỗng.').notEmpty();
  req.checkBody('password', 'Mật khẩu phải lớn hơn 6 kí tự.').isLength({ min: 6 });
  req.checkBody('repassword', 'Mật khẩu nhập lại không được rỗng.').notEmpty();

  const errors = req.validationErrors();
  if (errors) {
    respData.errors = errors;
    return res.json(respData);
  }
  if (req.body.password !== req.body.repassword) {
    respData.errors = [{ msg: 'Mật khẩu không hợp lệ.' }];
    return res.json(respData);
  }

  // Kiểm tra tồn tại email
  const email = req.body.email.trim().toLowerCase();
  const existing = await UserModel.find({ email }).lean();
  if (existing.length) {
    respData.errors = [{ msg: 'Email đã tồn tại.' }];
    return res.json(respData);
  }

  // Tạo tài khoản mới
  const salt = BcryptJs.genSaltSync(16);
  const hash = BcryptJs.hashSync(req.body.password, salt);

  await UserModel.create({
    fullname: req.body.fullname,
    email,
    password: hash,
    roles: [ UserRole.customer ]
  });

  req.flash('response_message', 'Đã Đăng Ký Thành Công.');
  respData.isSucceed = true;
  respData.message  = 'Thành công';
  return res.json(respData);
});

module.exports = router;
